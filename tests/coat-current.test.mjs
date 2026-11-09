import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fixture,until,input,finish,callTool} from './desk-helpers.mjs';
import {allHarnesses,currentHarnessRef,findHarness,resolvedCoat,harnessChoice} from '../public/harness-catalog.js';
import {chairEditor,rosterPanel} from '../public/roster-views.js';
import {harnessLibrary,harnessEditor} from '../public/harness-views.js';
import {harnessSnapshot} from '../server/harnesses.mjs';
import {applyCommand,appendExchange,finishExchange,validateState} from '../server/domain.mjs';
import {boundContext} from '../server/personal-context.mjs';
import {digest} from '../server/integrity.mjs';
import {replayJournal} from '../server/journal.mjs';

const content=(instructions,name='Builder')=>({name,description:'A reusable Coat',instructions,pockets:{profile:'branchline.coat-pockets/1',selected:[{tool:'read_clock',provider:'branchline.builtin/1'}]}});
async function createCoat(f){await f.command('harness.create',{content:content('ORIGINAL_COAT')});const h=f.app.store.state.customHarnesses.at(-1);return {id:h.id,version:1};}
async function wear(f,ref,visitor=false){const r=f.app.store.state.chats[0].seating,c=visitor?r.visitors[0]:r.desk;await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:c.id,modelId:c.modelId,personalId:c.personalId,name:c.name,coat:ref});}

test('one current Coat appears in controls; old selected chairs and continuity follow its edits',async()=>{
  const f=await fixture();try{
    const ref=await createCoat(f);await wear(f,ref);await wear(f,ref,true);
    const saved=structuredClone(f.app.store.state.customHarnesses[0].versions[0]);
    await f.command('harness.revise',{id:ref.id,baseVersion:1,content:content('UPDATED_COAT','Builder updated')});
    const s=f.app.store.state,chat=s.chats[0],current=currentHarnessRef(ref,s);
    assert.equal(allHarnesses(s).filter(h=>h.id===ref.id).length,1);assert.equal(current.version,2);
    assert.equal(findHarness(ref,s).instructions,'ORIGINAL_COAT');assert.deepEqual(s.customHarnesses[0].versions[0],saved);
    assert.equal(resolvedCoat(s,chat,'personal').ref.version,2);assert.equal(resolvedCoat(s,chat,'visiting').ref.version,2);
    const picker=chairEditor(s,chat,chat.seating.desk.id);
    assert.equal(picker.split(`value="${ref.id}@2"`).length-1,1);assert(!picker.includes(`${ref.id}@1`));assert(!picker.includes(' · v2'));
    assert.match(picker,new RegExp(`value="${ref.id}@2" selected`));assert.match(rosterPanel(s,chat),/Builder updated/);
    assert(!harnessLibrary(s).includes('saved version'));
    assert(!harnessEditor({content:content('UPDATED_COAT'),id:ref.id,baseVersion:2}).includes('Editing v'));
    const continuity=structuredClone(s);continuity.personalContext={profile:'branchline.personal-context/1',profiles:[],sharing:[],snapshots:[],bindings:[{id:'binding',chatId:f.chatId,seat:'personal',profileId:'profile',coat:ref}]};
    assert.equal(boundContext(continuity,f.chatId,'personal')?.id,'binding');
    continuity.chats[0].seating.desk.coat={id:'tutor',version:1};assert.equal(boundContext(continuity,f.chatId,'personal'),null);
    await f.command('harness.delete',{id:ref.id,baseVersion:2,baseDeletedAt:null});
    const removed=f.app.store.state;assert(!allHarnesses(removed).some(h=>h.id===ref.id));
    assert.equal(chairEditor(removed,removed.chats[0],chat.seating.desk.id).split(`value="${ref.id}@2"`).length-1,1);
  }finally{await f.close();}
});

test('editing a Coat preserves an active tool turn; a queued reply uses the updated instructions', {timeout:20000},async()=>{
  const f=await fixture();try{
    const ref=await createCoat(f);await wear(f,ref);
    await f.app.deskTasks.admit({...input(f,'First task','coat_first'),toolsEnabled:true});
    await until(()=>f.requests.length===1,'first request');
    const original=structuredClone(f.app.store.state.exchanges[0].harness);
    const queued=await f.app.deskTasks.admit({...input(f,'Queued task','coat_second'),toolsEnabled:true});
    await f.command('harness.revise',{id:ref.id,baseVersion:1,content:{...content('UPDATED_COAT'),pockets:{profile:'branchline.coat-pockets/1',selected:[]}}});
    callTool(f.requests[0],'read_clock',{});
    await until(()=>f.requests.length===2,()=>JSON.stringify(f.app.deskTasks.status()));
    assert(f.requests[1].body.messages.some(m=>m.role==='tool'),'Active turn still received its tool result');
    finish(f.requests[1],'First finished.');
    await until(()=>f.requests.length===3,()=>JSON.stringify(f.app.deskTasks.status()));
    const coatMessages=f.requests[2].body.messages.filter(m=>m.role==='system'&&m.content.includes('[Coat:'));
    assert.equal(coatMessages.length,1);assert.match(coatMessages[0].content,/UPDATED_COAT/);
    assert(!f.requests[2].body.tools?.some(t=>t.function?.name==='read_clock'),'Next turn uses the new pocket choices');
    finish(f.requests[2],'Second finished.');
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.deskTasks.status()));
    const state=f.app.store.state;assert.deepEqual(state.exchanges[0].harness,original);
    assert.equal(state.exchanges[1].harness.ref.version,2);
    assert.equal(state.deskWork.tasks.find(t=>queued.taskIds.includes(t.id)).selection.coat.ref.version,1,'Admission record remains exact');
    validateState(state);const replay=await replayJournal(path.join(f.dir,'workspace/events.jsonl'));assert.deepEqual(replay.state,state);
  }finally{await f.close();}
});

test('older Coat snapshots remain valid while future non-roster replies follow the current Coat',async()=>{
  const f=await fixture();try{
    const ref=await createCoat(f);
    let s=structuredClone(f.app.store.state),chat=s.chats[0];delete chat.seating;
    s=applyCommand(s,{type:'harness.select',payload:{chatId:f.chatId,baseRevisionId:null,baseDefaultId:null,shared:true,personal:ref,visiting:ref,saveAsDefault:false}});
    const model=s.models[0];
    for(const legacy of [true,false]){
      let state=structuredClone(s),c=state.chats[0];if(legacy){delete c.coatPolicy;delete c.coatChoices;}
      const snapshot=legacy?{selectionId:harnessChoice(c).id,shared:true,seat:'visiting',preset:findHarness(ref,state),hash:digest(findHarness(ref,state)),role:'response_guidance_only'}:harnessSnapshot(state,f.chatId);
      if(!legacy)delete snapshot.ref;
      state=appendExchange(state,f.chatId,{id:'old_exchange',modelId:model.id,content:'Before the edit'});state.exchanges[0].harness=snapshot;
      state=finishExchange(state,'old_exchange',{status:'completed',content:'Earlier answer'});validateState(state);
      state=applyCommand(state,{type:'harness.revise',payload:{id:ref.id,baseVersion:1,content:content('UPDATED_COAT')}});validateState(state);
      assert.deepEqual(state.exchanges[0].harness,snapshot);
      state=appendExchange(state,f.chatId,{id:'new_exchange',modelId:model.id,content:'After the edit'});validateState(state);
      assert.equal(state.exchanges[1].harness.ref.version,2);assert.equal(state.exchanges[1].harness.preset.instructions,'UPDATED_COAT');
    }
  }finally{await f.close();}
});

test('a saved Plan uses current Coat instructions and records the exact Coat it ran', {timeout:15000},async()=>{
  const f=await fixture({hold:false});try{
    const ref=await createCoat(f),date=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const plan=await f.app.plans.save({id:null,name:'Coat check',task:'Reply briefly.',rootId:null,workRootId:null,modelId:f.app.store.state.models[0].id,coat:ref,schedule:{date,time:'12:00',zone:'UTC',repeat:'once',intervalMinutes:60,weekdays:[1]},seconds:30,toolCalls:1,missed:'skip',enabled:false});
    await f.command('harness.revise',{id:ref.id,baseVersion:1,content:content('UPDATED_COAT')});
    await f.app.plans.action({id:plan.id,action:'run'});await until(()=>f.app.store.state.plans.runs[0]?.status==='finished',()=>JSON.stringify(f.app.store.state.plans));
    assert.equal(f.app.store.state.plans.items[0].coat.version,1);assert.equal(f.app.store.state.plans.runs[0].coat.version,2);
    assert(f.requests[0].body.messages.some(m=>m.role==='system'&&m.content.includes('[Coat:')&&m.content.includes('UPDATED_COAT')));
  }finally{await f.close();}
});
