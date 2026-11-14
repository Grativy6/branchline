import {returnMap,readReturnSource} from '../server/return-map.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input,until} from './desk-helpers.mjs';
import {deskEvent,writeDrawer,writeDeskArtifact,readDeskRecord,readDrawer} from '../server/desk-work.mjs';
import {compileMessages} from '../server/model.mjs';
import {resolveSpeaker} from '../server/table.mjs';
import {STARTER_HARNESSES} from '../public/harness-catalog.js';
import {STARTER_COLORS,coatPreferences} from '../public/coat-options.js';
import {exportHarness,previewHarnessImport} from '../server/harness-files.mjs';

test('the shared map keeps current artifacts and the latest own return point despite busy event history',async()=>{
 const f=await fixture({hold:false});try{
 await f.app.deskTasks.admit(input(f,'Work on the project.'));await until(()=>f.app.store.state.deskWork.tasks[0].status==='completed','first turn');
 const task=f.app.store.state.deskWork.tasks[0];let artifact;
 await f.app.store.transact(s=>{
   writeDrawer(s,task,{name:'Current work',text:'Old return point.',revision:''});
   writeDrawer(s,task,{name:'Another note',text:'Older unrelated work.',revision:''});
   const revision=s.deskWork.drawers[0].notes[0].revisions.at(-1).id;
   writeDrawer(s,task,{name:'Current work',text:'CURRENT_FILE project.html\n'+ 'supporting detail '.repeat(500)+'\nNEXT_STEP verify the corrected controls.',revision});
   artifact=writeDeskArtifact(s,task,{title:'Current project build',text:'COMPLETE_ARTIFACT_CONTENT'});
   for(let i=0;i<35;i++)deskEvent(s,task,'task.update',{summary:'event '+i+' '+ 'noise '.repeat(80)});
   return s;
 });
 const s=f.app.store.state,original=JSON.stringify(s),map=returnMap(s,f.chatId,task.selection),own=map.slots.ownWork;
 assert(own.drawer.returnNote.opening.includes('CURRENT_FILE'));assert(own.drawer.returnNote.ending.includes('NEXT_STEP'));
 assert(map.slots.task.artifacts.routes.some(a=>a.source.includes(artifact.id)));
 const event=readReturnSource(s,f.chatId,task.selection,{source:map.slots.changes.items.at(-1).source});assert(event.text.includes('event 34'));
 assert(readDeskRecord(s,f.chatId,{id:artifact.id,revision:'',offset:0}).text.includes('COMPLETE_ARTIFACT_CONTENT'));
 assert(readDrawer(s,task,{name:'Current work',offset:7000}).text.includes('NEXT_STEP'));assert.equal(JSON.stringify(s),original);
 }finally{await f.close();}
});
test('a broadcast appears once with recipients; distinct later repetitions and source records remain',async()=>{
 const f=await fixture({hold:false});try{
 const phrase='BROADCAST_UNIQUE_BODY please compare approaches.';
 await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:f.app.store.state.chats[0].seating.revisionId,mode:'all',speaker:'personal'});
 await f.app.deskTasks.admit(input(f,phrase));await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'group');
 const s=f.app.store.state,batch=s.deskWork.batches[0],original=JSON.stringify(s.messages),{selection}=resolveSpeaker(s,f.chatId,'personal');
 let messages=compileMessages(s,f.chatId,'Next step.',{selection,maxContextCharacters:1000000});
 const group=messages.filter(m=>m.content.startsWith('[Earlier human group prompt'));assert.equal(group.length,1);assert(group[0].content.includes('Hearthline')&&group[0].content.includes('Qwen'));assert(group[0].content.endsWith(batch.original));assert.equal(group[0].content.split(phrase).length-1,1);assert.equal(JSON.stringify(s.messages),original);
 await f.app.deskTasks.admit(input(f,phrase,'later_repeat'));await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'repeat');
 messages=compileMessages(f.app.store.state,f.chatId,'Next step.',{selection,maxContextCharacters:1000000});assert.equal(messages.filter(m=>m.content.startsWith('[Earlier human group prompt')).length,2);
 }finally{await f.close();}
});
test('starter colors are fixed and portable; custom colors use the existing editor',async()=>{
 const f=await fixture();try{
 assert.equal(Object.keys(STARTER_COLORS).length,STARTER_HARNESSES.length);
 for(const starter of STARTER_HARNESSES){assert.match(coatPreferences(f.app.store.state,starter.id).color,/^#[0-9a-f]{6}$/);await assert.rejects(f.command('harness.options',{id:starter.id,options:{color:'#000000',thinking:false,thinkingContextCharacters:4000}}),/custom Coats/);}
 const exported=exportHarness(f.app.store.state,{id:'conversation',version:1}),content=previewHarnessImport({name:'coat.json',base64:Buffer.from(exported.text).toString('base64')}).content;
 assert.equal(content.options.color,STARTER_COLORS.conversation);await f.command('harness.create',{content:{...content,instructions:'Custom conversation.'}});const id=f.app.store.state.customHarnesses.at(-1).id;
 await f.command('harness.options',{id,options:{...content.options,color:'#123456'}});assert.equal(coatPreferences(f.app.store.state,id).color,'#123456');assert.equal(coatPreferences(f.app.store.state,'conversation').color,STARTER_COLORS.conversation);
 }finally{await f.close();}
});
