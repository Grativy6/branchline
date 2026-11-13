import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input,until,callTool,finish} from './desk-helpers.mjs';
import {exportHarness,previewHarnessImport} from '../server/harness-files.mjs';
import {coatPreferences,messageCoatId} from '../public/coat-options.js';
import {thinkingMessages,thinkingChoice,ThinkingNotes} from '../server/thinking-notes.mjs';
import {deskContext,inspectChairLog} from '../server/desk-work.mjs';
import {resolveSpeaker} from '../server/table.mjs';
import {replayJournal} from '../server/journal.mjs';
import {conversationMessages} from '../public/conversation-records.js';

const prefs={color:'#e457be',thinking:true,thinkingContextCharacters:4000};
async function coat(f){
 await f.command('harness.create',{content:{name:'Builder',description:'',instructions:'Build useful things.'}});
 const id=f.app.store.state.customHarnesses.at(-1).id;
 await f.command('harness.options',{id,options:prefs});
 const c=f.app.store.state.chats[0];
 await f.command('table.roster.chair',{chatId:c.id,baseRevisionId:c.seating.revisionId,chairId:c.seating.desk.id,name:'Builder',modelId:c.seating.desk.modelId,personalId:null,coat:{id,version:1}});return id;
}
test('Coat choices persist without instruction versions; JSON carries them and plain instructions do not',async()=>{
 const f=await fixture();try{
 const id=await coat(f);assert.equal(f.app.store.state.customHarnesses[0].versions.length,1);
 const json=exportHarness(f.app.store.state,{id,version:1}).text;
 const imported=previewHarnessImport({name:'coat.json',base64:Buffer.from(json).toString('base64')});assert.deepEqual(imported.content.options,prefs);
 assert.equal(exportHarness(f.app.store.state,{id,version:1},'md').text,'Build useful things.');
 await f.command('harness.create',{content:imported.content});assert.deepEqual(coatPreferences(f.app.store.state,f.app.store.state.customHarnesses.at(-1).id),prefs);
 assert.equal(coatPreferences(f.app.store.state,'conversation').thinking,false);
 await assert.rejects(f.command('harness.options',{id,options:{...prefs,color:'red;display:none'}}));
 }finally{await f.close();}
});
test('requested note stays in its own drawer, is bounded and selectable later, and survives journal replay',async()=>{
 const f=await fixture();try{
 const id=await coat(f),batch=await f.app.deskTasks.admit({...input(f,'Make a greeting.'),toolsEnabled:true});
 await until(()=>f.requests.length===1,()=>JSON.stringify(f.app.store.state.deskWork.tasks));
 assert(f.requests[0].body.messages.some(m=>m.content.includes('You are brainstorming.')));
 assert(f.requests[0].body.messages.some(m=>m.content.includes('Build useful things.')));
 const text='WORKING_NOTE: A tentative idea; revise if the evidence changes. '+ 'detail '.repeat(700);
 callTool(f.requests[0],'record_reasoning_note',{text,ping_id:'',corrects:''});
 await until(()=>f.requests.length===2,()=>JSON.stringify(f.app.store.state.deskWork.tasks));
 assert.equal(JSON.parse(f.requests[1].body.messages.at(-1).content).value.saved,true);
 finish(f.requests[1],'Hello from the builder.');
 await until(()=>f.app.store.state.deskWork.tasks[0].status==='completed',()=>JSON.stringify(f.app.store.state.deskWork.tasks));
 const s=f.app.store.state,t=s.deskWork.tasks[0],d=s.deskWork.drawers.find(d=>d.chairId===t.chairId),note=d.notes[0];
 assert.equal(note.revisions[0].text,text);assert(!s.messages.some(m=>m.content.includes('WORKING_NOTE')));
 const own=thinkingMessages(s,f.chatId,t.selection,thinkingChoice(s,t.selection));assert(own.some(m=>m.content.includes('WORKING_NOTE')));assert(own.reduce((n,m)=>n+m.content.length,0)<=4000);
 assert(!deskContext(s,f.chatId,t.selection).some(m=>m.content.includes('WORKING_NOTE')));
 const other=resolveSpeaker(s,f.chatId,'visiting').selection;assert.deepEqual(thinkingMessages(s,f.chatId,other,{enabled:true,characters:4000}),[]);
 assert(inspectChairLog(s,{chatId:f.chatId}, {chair_id:t.chairId}).text.includes('WORKING_NOTE'));
 await f.command('thinking.note.select',{drawerId:d.id,revisionId:note.revisions[0].id,selected:false});
 assert.deepEqual(thinkingMessages(f.app.store.state,f.chatId,t.selection),[]);
 const replay=await replayJournal(f.app.store.file);assert.equal(replay.state.deskWork.drawers[0].notes[0].revisions[0].text,text);
 assert.deepEqual(coatPreferences(replay.state,id),prefs);
 const reply=s.messages.find(m=>m.role==='assistant');assert.equal(messageCoatId(s,reply),id);
 const sender={...t,id:'sender'},fake=structuredClone(s);fake.deskWork.tasks.push(sender);fake.deskWork.batches.push({id:'peer-batch',chatId:f.chatId,original:'Please check this.',originTaskId:sender.id,createdAt:new Date().toISOString()});
 assert.equal(messageCoatId(fake,conversationMessages(fake,f.chatId).find(m=>m.id==='peer-batch')),id);
 assert.equal(messageCoatId(s,s.messages.find(m=>m.role==='user')),null);
 }finally{await f.close();}
});
test('native thinking is retained through live tool calls and saved completely apart from the final reply',async()=>{
 const f=await fixture();try{
 await coat(f);await f.app.deskTasks.admit({...input(f,'Check the desk.'),toolsEnabled:true});await until(()=>f.requests.length===1,'native request');
 const q=f.requests[0],native='NATIVE_THINKING '+ 'z'.repeat(4200);
 q.res.writeHead(200,{'content-type':'text/event-stream'});
 q.res.end(`data: ${JSON.stringify({choices:[{delta:{reasoning_content:native},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'read_1',type:'function',function:{name:'read_drawer',arguments:'{"name":"","offset":0}'}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
 await until(()=>f.requests.length===2,()=>JSON.stringify(f.app.store.state.deskWork.tasks));
 assert.equal(f.requests[1].body.messages.find(m=>m.tool_calls)?.reasoning_content,native);
 finish(f.requests[1],'The drawer was empty.');await until(()=>f.app.store.state.deskWork.tasks[0].status==='completed',()=>JSON.stringify(f.app.store.state.deskWork.tasks));
 const event=f.app.store.state.deskWork.events.find(e=>e.kind==='thinking.saved');assert.equal(event.detail.source,'native_thinking');
 assert.equal(f.app.store.state.deskWork.drawers[0].notes[0].revisions[0].text,native);
 assert(!f.app.store.state.messages.some(m=>m.content.includes('NATIVE_THINKING')));
 const count=f.requests.length;await f.app.deskTasks.kick();assert.equal(f.requests.length,count);
 }finally{await f.close();}
});
test('an exposed summary is labelled separately, missing notes remain missing, and idle ticks cannot generate',async()=>{
 const f=await fixture();try{
 await coat(f);await f.app.deskTasks.admit(input(f,'Hello.'));await until(()=>f.requests.length===1,'text request');
 assert(!f.requests[0].body.messages.some(m=>m.content.includes('You are brainstorming.')));finish(f.requests[0]);await until(()=>f.app.store.state.deskWork.tasks[0].status==='completed','done');
 assert(f.app.store.state.deskWork.events.some(e=>e.kind==='thinking.unavailable'));assert.equal(f.app.store.state.deskWork.drawers[0].notes.length,0);
 const task=f.app.store.state.deskWork.tasks[0],notes=new ThinkingNotes({store:f.app.store,task,exchangeId:task.exchangeId});
 await notes.receive({source:'provider_summary',itemId:'summary1',part:0,text:'An exposed summary.',complete:true});for(let i=0;i<10;i++)await notes.tick();await notes.close();await notes.close();
 assert.equal(f.app.store.state.deskWork.events.filter(e=>e.kind==='thinking.saved').length,1);assert.equal(f.requests.length,1);
 }finally{await f.close();}
});
