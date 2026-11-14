import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initialState,applyCommand,validateState} from '../server/domain.mjs';
import {Store} from '../server/store.mjs';
import {resolveSpeaker} from '../server/table.mjs';
import {compileMessages} from '../server/model.mjs';
import {hatHead,findHat,memoryHead,deskMemory,memoryChoice,threadHead,HAT_OPENING} from '../public/hats.js';
import {saveHatNote,saveHatIntro,saveDeskMemory,proposeDeskMemory,executeReturnWrite,returnActor,preserveReturnRecords,applyCarryThreadReviews} from '../server/return-records.mjs';
import {returnMap,readReturnSource,searchReturnSources,sourceStanding,captureReturnAnchor,recordReturnSupply,assertReturnDisclosure} from '../server/return-map.mjs';
import {makeToolContract,validToolContract} from '../server/tool-contract.mjs';
import {RETURN_TOOLS} from '../server/return-records.mjs';
import {fixture,input,until,callTool,finish} from './desk-helpers.mjs';
import {digest} from '../server/integrity.mjs';
import {beginCarry,parseCarryResult,completeCarry,continueFromHandoff} from '../server/context-carry.mjs';
import {writeDeskArtifact} from '../server/desk-work.mjs';
import {prepareModelHandoff,assertModelInvocation} from '../server/handoff.mjs';
import {prepareModelWrite} from '../server/effect-boundary.mjs';

function setup(){
 let s=applyCommand(initialState(),{type:'root.create',payload:{name:'Station',mode:'personal'}});
 s=applyCommand(s,{type:'model.save',payload:{name:'Local test',model:'fixture',baseUrl:'http://127.0.0.1:19009/v1',runtime:'compatible',thinking:false}});
 const chatId=s.chats[0].id,rootId=s.roots[0].id;
 s=applyCommand(s,{type:'table.roster.start',payload:{chatId}});
 function send(type,payload){s=applyCommand(s,{type,payload});return s;}
 function chair(chat,id,name,hatId=null,notes=true){send('table.roster.chair',{chatId:chat,baseRevisionId:s.chats.find(c=>c.id===chat).seating.revisionId,chairId:id,name,modelId:s.models[0].id,personalId:null,coat:null,hatId,hatNotesAllowed:notes});}
 chair(chatId,s.chats[0].seating.desk.id,'Builder');chair(chatId,null,'Tester');
 function hat(name,intro='Remember the exact build.'){send('return.hat.create',{name,intro,allowChairIntro:false});return s.returnRecords.hats.at(-1).id;}
 function task(chat=chatId,chairId=s.chats.find(c=>c.id===chat).seating.desk.id){const r=s.chats.find(c=>c.id===chat).seating,seat=chairId===r.desk.id?'personal':'visiting',{selection,model}=resolveSpeaker(s,chat,seat,chairId);return {id:'fixture_task_'+chairId,chatId:chat,chairId,selection,model};}
 return {get s(){return s;},set s(v){s=v;},chatId,rootId,send,chair,hat,task};
}

test('Hat selection is independent, unique within a branch, and supplies the exact tools-off doorway',()=>{
 const f=setup(),hat=f.hat('Continuity','Keep the return path.');f.chair(f.chatId,f.s.chats[0].seating.desk.id,'Builder',hat);
 const visitor=f.s.chats[0].seating.visitors[0];assert.throws(()=>f.chair(f.chatId,visitor.id,'Tester',hat),/already worn/);
 const selection=f.task().selection,body=compileMessages(f.s,f.chatId,'Hello',{selection,maxContextCharacters:100000});
 assert(body.some(m=>m.content===HAT_OPENING+'\n\nKeep the return path.'));assert.equal(returnMap(f.s,f.chatId,selection).slots.hat.id,hat);
 assert.equal(f.s.chats[0].seating.desk.coat,null);assert.equal(f.s.models.length,1);validateState(f.s);
});

test('shared Hats retain authors, duplicates diverge and conflicts retain both edits',()=>{
 const f=setup(),h=f.hat('Shared');f.chair(f.chatId,f.s.chats[0].seating.desk.id,'Builder',h);const a=returnActor(f.task());
 const first=saveHatNote(f.s,{hatId:h,title:'Lesson',text:'Inspect the actual file.',sources:[]},a);
 const before=structuredClone(f.s);
 saveHatNote(f.s,{hatId:h,noteId:first.noteId,revision:first.revision,title:'Lesson',text:'Inspect and compare.',sources:[]},{kind:'human',name:'You'});
 const conflict=saveHatNote(f.s,{hatId:h,noteId:first.noteId,revision:first.revision,title:'Lesson',text:'Concurrent proposal.',sources:[]},a);
 assert.equal(conflict.conflict,true);assert.equal(findHat(f.s,h).notes[0].revisions.at(-1).text,'Inspect and compare.');assert(f.s.returnRecords.events.at(-1).detail.submitted.text.includes('Concurrent'));preserveReturnRecords(before,f.s);
 f.send('return.hat.duplicate',{id:h,revision:hatHead(findHat(f.s,h)).id,name:'Independent'});const fork=f.s.returnRecords.hats.at(-1);
 assert.equal(fork.notes[0].revisions[0].author.chairId,a.chairId);const v=fork.notes[0].revisions.at(-1);
 saveHatNote(f.s,{hatId:fork.id,noteId:fork.notes[0].id,revision:v.id,title:'Lesson',text:'A different route.',sources:[]},a);
 assert.equal(findHat(f.s,h).notes[0].revisions.at(-1).text,'Inspect and compare.');validateState(f.s);
});

test('Hat-note switch and intro setting are separate, and wrong-Hat writes do not mutate either Hat',()=>{
 const f=setup(),h=f.hat('One'),other=f.hat('Two');f.chair(f.chatId,f.s.chats[0].seating.desk.id,'Builder',h,false);const t=f.task();
 assert.throws(()=>executeReturnWrite(f.s,t,'write_hat_note',{hat_id:h,note_id:'',revision:'',title:'Note',text:'No',sources:[]}),/writing is off/);
 assert.throws(()=>executeReturnWrite(f.s,t,'write_hat_note',{hat_id:other,note_id:'',revision:'',title:'Note',text:'No',sources:[]}),/scope conflict/);
 assert.throws(()=>saveHatIntro(f.s,{hatId:h,revision:hatHead(findHat(f.s,h)).id,intro:'No',sources:[]},returnActor(t)),/intro are off/);
 const v=hatHead(findHat(f.s,h));f.send('return.hat.save',{id:h,revision:v.id,name:v.name,intro:v.intro,allowChairIntro:true,archived:false});
 assert.equal(executeReturnWrite(f.s,f.task(),'update_hat_intro',{hat_id:h,revision:hatHead(findHat(f.s,h)).id,intro:'Chosen new intro.',sources:[]}).saved,true);
 assert.equal(findHat(f.s,h).notes.length,0);assert.equal(findHat(f.s,other).notes.length,0);assert.equal(f.s.chats[0].seating.desk.hatNotesAllowed,false);
});

test('desk MEMORY is optional, author-specific, shared across branches, and preserves human edits and objections',()=>{
 const f=setup();f.send('return.memory.configure',{rootId:f.rootId,chatId:f.chatId,enabled:true,authorChatId:'',authorChairId:''});
 const owner=f.task(),other=f.task(f.chatId,f.s.chats[0].seating.visitors[0].id);assert.equal(memoryChoice(deskMemory(f.s,f.rootId)).author.chairId,owner.chairId);
 assert.throws(()=>saveDeskMemory(f.s,{rootId:f.rootId,text:'Unauthorized',sources:[]},returnActor(other)),/designated/);
 const proposal=proposeDeskMemory(f.s,{rootId:f.rootId,text:'The test remains pending.',kind:'objection',sources:[]},returnActor(other));
 const first=saveDeskMemory(f.s,{rootId:f.rootId,text:'Current project.',sources:[]},returnActor(owner));
 saveDeskMemory(f.s,{rootId:f.rootId,revision:first.revision,text:'Human correction.',sources:[]});
 const held=saveDeskMemory(f.s,{rootId:f.rootId,revision:first.revision,text:'Stale writer.',sources:[]},returnActor(owner));assert(held.conflict);assert.equal(memoryHead(deskMemory(f.s,f.rootId)).text,'Human correction.');
 f.send('chat.create',{rootId:f.rootId,title:'A new branch',setupChairs:true});const newChat=f.s.chats.at(-1);
 assert(returnMap(f.s,newChat.id,null).slots.memory.enabled);assert.equal(f.s.returnRecords.threads.length,0);assert(deskMemory(f.s,f.rootId).proposals.some(p=>p.id===proposal.proposalId));
 f.send('return.memory.configure',{rootId:f.rootId,chatId:f.chatId,enabled:false,authorChatId:'',authorChairId:''});assert.deepEqual(returnMap(f.s,newChat.id,null).slots.memory,{enabled:false});assert.equal(memoryHead(deskMemory(f.s,f.rootId)).text,'Human correction.');validateState(f.s);
});

test('thread reviews preserve identity, criteria and conflicting newer state through a handoff',()=>{
 const f=setup();f.send('return.thread.save',{chatId:f.chatId,id:'',revision:'',title:'Keyboard controls',question:'Do the keys work?',criterion:'Test revision 5 with keyboard controls.',lookFor:'Keyboard test receipt',status:'open',reason:'',sources:[],watch:[],evidence:[]});
 const t=f.s.returnRecords.threads[0],anchor=captureReturnAnchor(f.s,f.chatId),before=threadHead(t);
 const record={id:'carry_fixture',chatId:f.chatId,jobId:'job_fixture',modelLabel:'Recorder',author:'model',returnAnchor:anchor,threadReviews:[{id:t.id,title:'Ignored replacement title',question:'Ignored',criterion:'Ignored easier criterion',lookFor:'',status:'unverified',reason:'Reported complete; test missing.',sources:[],evidence:[]}]};
 applyCarryThreadReviews(f.s,record);assert.equal(threadHead(t).criterion,before.criterion);assert.equal(threadHead(t).status,'unverified');const n=t.revisions.length;applyCarryThreadReviews(f.s,record);assert.equal(t.revisions.length,n);
 f.send('return.thread.save',{chatId:f.chatId,id:t.id,revision:threadHead(t).id,title:'Keyboard controls',question:'Do the keys work?',criterion:'Revised human criterion.',lookFor:'Updated test',status:'open',reason:'',sources:[],watch:[],evidence:[]});
 applyCarryThreadReviews(f.s,{...record,id:'carry_later'});assert.equal(threadHead(f.s.returnRecords.threads[0]).criterion,'Revised human criterion.');assert(f.s.returnRecords.events.some(e=>e.kind==='conflict'));validateState(f.s);
});

test('exact source routes, recorded corrections and original data survive a store reopen',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-return-records-')),store=new Store(dir);await store.open();try{
 const f=setup(),h=f.hat('Archive');f.chair(f.chatId,f.s.chats[0].seating.desk.id,'Builder',h);
 const first=saveHatNote(f.s,{hatId:h,title:'Original',text:'Original exact text.',sources:[]});
 const second=saveHatNote(f.s,{hatId:h,title:'Derived',text:'A derived observation.',sources:[first.source]});
 f.send('return.correction',{chatId:f.chatId,target:first.source,status:'contested',reason:'A later check disagreed.',replacement:''});
 assert.equal(readReturnSource(f.s,f.chatId,f.task().selection,{source:first.source}).standing[0].status,'contested');
 assert(sourceStanding(f.s,second.source).some(c=>c.relation==='depends_on'));
 assert(searchReturnSources(f.s,f.chatId,f.task().selection,{query:'Original exact text.',offset:0}).rows.some(r=>r.source===first.source));
 await store.transact(()=>f.s);await store.close();const reopened=new Store(dir);await reopened.open();assert.equal(readReturnSource(reopened.state,f.chatId,f.task().selection,{source:first.source}).text.includes('Original exact text.'),true);await reopened.close();
 }finally{await store.close();}
});

test('real request assembly and tool dispatch record an attributed Hat note without an orientation call',async()=>{
 let turns=0;const f=await fixture({reply:q=>{turns++;if(turns===1)callTool(q,'write_hat_note',{hat_id:'',note_id:'',revision:'',title:'Return point',text:'Actual dispatched note.',sources:[]});else finish(q,'Saved the return point.');}});
 try{
 await f.command('return.hat.create',{name:'Crew Hat',intro:'Keep the exact return path.',allowChairIntro:false});const h=f.app.store.state.returnRecords.hats[0],chat=f.app.store.state.chats[0];
 await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:chat.seating.revisionId,chairId:chat.seating.desk.id,name:chat.seating.desk.name,modelId:chat.seating.desk.modelId,personalId:null,coat:null,hatId:h.id,hatNotesAllowed:true});
 assert.equal(f.requests.length,0);
 await f.app.deskTasks.admit({...input(f,'Save a return note.'),toolsEnabled:true});await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.deskTasks.status()),10000);
 assert.equal(f.requests.length,2);assert(f.requests[0].body.messages.some(m=>m.content===HAT_OPENING+'\n\nKeep the exact return path.'));
 const saved=f.app.store.state.returnRecords.hats[0].notes[0];assert.equal(saved.revisions[0].text,'Actual dispatched note.');assert.equal(saved.revisions[0].author.chairId,chat.seating.desk.id);
 assert.equal(f.app.store.state.returnRecords.supplies.length,1);assert.equal(returnMap(f.app.store.state,f.chatId,f.app.store.state.deskWork.tasks[0].selection).slots.changes.sinceInput,f.app.store.state.returnRecords.supplies[0].id);
 const t=f.app.store.state.deskWork.tasks[0],contract=makeToolContract(f.app.store.state,{chatId:f.chatId,model:t.model,seat:t.selection.seat,enabled:true,deskTaskId:t.id,chairId:t.chairId});
 assert(validToolContract(contract,t.model));const legacy=structuredClone(contract);delete legacy.returnContext;legacy.tools=legacy.tools.filter(n=>!RETURN_TOOLS.includes(n));assert(validToolContract(legacy,t.model),'saved 1.1 contracts must retain their original catalogue');
 }finally{await f.close();}
});

test('same Hat in different branches keeps separate supply markers, including after a failed reply',async()=>{
 let failNext=false;const f=await fixture({reply:q=>{if(failNext){q.res.writeHead(503);q.res.end('Synthetic provider failure');}else finish(q);}});
 try{
 await f.command('return.hat.create',{name:'Shared resident',intro:'Keep separate chair work.',allowChairIntro:false});const hid=f.app.store.state.returnRecords.hats[0].id;
 const firstChat=f.app.store.state.chats[0],firstChair=firstChat.seating.desk;
 await f.command('table.roster.chair',{chatId:firstChat.id,baseRevisionId:firstChat.seating.revisionId,chairId:firstChair.id,name:firstChair.name,modelId:firstChair.modelId,personalId:null,coat:null,hatId:hid,hatNotesAllowed:true});
 await f.command('chat.create',{rootId:firstChat.rootId,title:'Other room in this desk',setupChairs:true});let second=f.app.store.state.chats.at(-1);await f.command('table.roster.start',{chatId:second.id});second=f.app.store.state.chats.at(-1);
 await f.command('table.roster.chair',{chatId:second.id,baseRevisionId:second.seating.revisionId,chairId:second.seating.desk.id,name:'Second wearer',modelId:firstChair.modelId,personalId:null,coat:null,hatId:hid,hatNotesAllowed:true});
 await f.app.deskTasks.admit(input(f,'First chair hello.','supply_a'));await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'A completed');const a=f.app.store.state.deskWork.tasks[0],receipt=f.app.store.state.returnRecords.supplies[0].id;
 await f.command('return.hat.note',{hatId:hid,noteId:'',revision:'',title:'A later lesson',text:'This arrived while B was away.',sources:[]});
 second=f.app.store.state.chats.at(-1);
 await f.app.deskTasks.admit({chatId:second.id,chairId:second.seating.desk.id,content:'Second chair hello.',requestId:'supply_b',baseRevisionId:second.seating.revisionId,lastMessageId:null,toolsEnabled:false});await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'B completed');
 assert.equal(returnMap(f.app.store.state,f.chatId,a.selection).slots.changes.sinceInput,receipt);assert(returnMap(f.app.store.state,f.chatId,a.selection).slots.changes.items.some(e=>e.kind==='hat.note'));
 failNext=true;await f.app.deskTasks.admit(input(f,'Synthetic failure.','supply_fail'));await until(()=>f.app.store.state.deskWork.tasks.at(-1).status==='failed','failed reply recorded');
 assert.equal(returnMap(f.app.store.state,f.chatId,a.selection).slots.changes.sinceInput,receipt);assert.equal(f.app.store.state.returnRecords.supplies.length,3);
 }finally{await f.close();}
});

test('handoff reviews use watched later revisions and are applied only when that handoff is used',()=>{
 const f=setup();for(let i=0;i<12;i++)f.send('message.note',{chatId:f.chatId,content:'Original source '+i+' '+ 'Relevant recorded material. '.repeat(70)});
 const task=f.task(),old=writeDeskArtifact(f.s,task,{id:'',revision:'',title:'Keyboard evidence',text:'Revision 1 still needs a keyboard test.'});
 f.send('return.thread.save',{chatId:f.chatId,id:'',revision:'',title:'Keyboard controls',question:'Are the repaired controls tested?',criterion:'A recorded keyboard test of the current build.',lookFor:'Keyboard test receipt',status:'open',reason:'',sources:[],watch:[`artifact:${f.chatId}:${old.id}:${old.revision}`],evidence:[]});
 const newer=writeDeskArtifact(f.s,task,{id:old.id,revision:old.revision,title:'Keyboard evidence',text:'Synthetic test receipt: keyboard checks passed for revision 5.'});
 const {job,messages}=beginCarry(f.s,{chatId:f.chatId,speaker:'personal',baseId:null,lastMessageId:f.s.messages.at(-1).id},{maxContextCharacters:200000});
 const candidate=`artifact:${f.chatId}:${newer.id}:${newer.revision}`;assert(messages.some(m=>m.content.includes('keyboard checks passed for revision 5')));assert(job.returnAnchor.threads[0].candidates.some(c=>c.source===candidate));
 const t=f.s.returnRecords.threads[0],parsed=parseCarryResult(f.s,job,JSON.stringify({account:'Continue the project with its recorded test evidence. [M1]',threads:[{id:t.id,title:'',question:'',criterion:'',lookFor:'',status:'resolved',reason:'The supplied test receipt addresses the criterion.',sources:['M1'],evidence:[candidate]}]}));
 completeCarry(f.s,job.id,{result:parsed});assert.equal(threadHead(t).status,'open');
 const record=f.s.contextCarry.records.at(-1);continueFromHandoff(f.s,{chatId:f.chatId,baseId:null,recordId:record.id,lastMessageId:f.s.messages.at(-1).id});
 assert.equal(threadHead(t).status,'resolved');assert.equal(threadHead(t).criterion,'A recorded keyboard test of the current build.');assert(threadHead(t).evidence.includes(candidate));validateState(f.s);
});

test('Hat JSON import preserves original note attribution without inheriting intro-edit permission',()=>{
 const f=setup(),hid=f.hat('Original');const a=returnActor(f.task());saveHatNote(f.s,{hatId:hid,title:'Original note',text:'A selected memory.',sources:[]},a);
 const h=findHat(f.s,hid),v=hatHead(h);f.send('return.hat.save',{id:hid,revision:v.id,name:v.name,intro:v.intro,allowChairIntro:true,archived:false});
 const original=structuredClone(findHat(f.s,hid));f.send('return.hat.import',{name:'Chosen import',bundle:{format:'branchline.hat-export/1',hat:original}});
 const imported=f.s.returnRecords.hats.at(-1);assert.notEqual(imported.id,hid);assert.equal(imported.notes[0].revisions[0].author.chairId,a.chairId);assert.equal(hatHead(imported).allowChairIntro,false);assert.equal(hatHead(findHat(f.s,hid)).allowChairIntro,true);validateState(f.s);
});

test('an unsupported thread proposal is retained without blocking a valid handoff account',()=>{
 const f=setup();for(let i=0;i<12;i++)f.send('message.note',{chatId:f.chatId,content:'Saved material '+i+' '+ 'Original context. '.repeat(100)});
 const {job}=beginCarry(f.s,{chatId:f.chatId,speaker:'personal',baseId:null,lastMessageId:f.s.messages.at(-1).id},{maxContextCharacters:200000});
 const parsed=parseCarryResult(f.s,job,JSON.stringify({account:'Keep the recorded context. [M1]',threads:[{id:'invented_thread',title:'Unfounded closure',question:'?',criterion:'?',lookFor:'',status:'resolved',reason:'Claimed.',sources:['M999999'],evidence:[]}]}));
 assert.equal(parsed.threadReviews.length,0);assert.equal(parsed.threadReviewIssues.length,1);completeCarry(f.s,job.id,{result:parsed});
 const record=f.s.contextCarry.records.at(-1);continueFromHandoff(f.s,{chatId:f.chatId,baseId:null,recordId:record.id,lastMessageId:f.s.messages.at(-1).id});assert.equal(f.s.contextCarry.active[f.chatId],record.id);assert.equal(f.s.returnRecords?.threads.length??0,0);validateState(f.s);
});

test('imported source claims cannot manufacture access to another conversation',()=>{
 const f=setup();f.send('chat.create',{rootId:f.rootId,title:'Unshared original'});const other=f.s.chats.at(-1);
 f.send('message.note',{chatId:other.id,content:'PRIVATE_ORIGIN_RECORD'});const hidden=f.s.messages.at(-1),source=`message:${other.id}:${hidden.id}`;
 const hid=f.hat('File source');saveHatNote(f.s,{hatId:hid,title:'Claimed route',text:'A claimed imported connection.',sources:[source]});
 const bundle={format:'branchline.hat-export/1',hat:structuredClone(findHat(f.s,hid))};f.send('return.hat.import',{name:'Imported',bundle});const imported=f.s.returnRecords.hats.at(-1);
 f.chair(f.chatId,f.s.chats[0].seating.desk.id,'Builder',imported.id);assert.equal(imported.notes[0].revisions[0].sourceBindingsRecorded,false);
 assert.throws(()=>readReturnSource(f.s,f.chatId,f.task().selection,{source}),/outside/);assert(readReturnSource(f.s,f.chatId,f.task().selection,{source,human:true},{human:true}).text.includes('PRIVATE_ORIGIN_RECORD'));
});

test('the optional after-handoff update queues once behind current work and stays separate from the project return point',async()=>{
 const f=await fixture();try{
 for(let i=0;i<12;i++)await f.command('message.note',{chatId:f.chatId,content:'Saved conversation '+i+' '+ 'Original working evidence. '.repeat(60)});
 const rootId=f.app.store.state.chats[0].rootId;
 await f.command('return.memory.configure',{rootId,chatId:f.chatId,enabled:true,authorChatId:'',authorChairId:'',automaticAfterHandoff:true});
 let recordId,prep,handoff;
 await f.app.store.transact(s=>{
   prep=beginCarry(s,{chatId:f.chatId,speaker:'personal',baseId:null,lastMessageId:s.messages.at(-1).id},{maxContextCharacters:200000});
   handoff=prepareModelHandoff(s,{taskId:prep.job.id,chatId:f.chatId,kind:'carry',messages:prep.messages,purpose:'Synthetic handoff preparation',selection:prep.selection});
   return s;
 });
 assertModelInvocation(handoff,prep.messages,prep.model);
 await f.app.store.transact(s=>{
   const result=prepareModelWrite(s,handoff,{content:JSON.stringify({account:'Continue the recorded project. [M1]',threads:[]}),finishReason:'stop'});assert(result.accepted,result.issue??JSON.stringify(result.state.handoffs.records.at(-1)));const next=result.state;recordId=next.contextCarry.records.at(-1).id;return next;
 });
 await f.app.deskTasks.pump();assert.equal(f.requests.length,0,'a merely prepared handoff must not queue an update');
 await f.app.deskTasks.admit(input(f,'Keep working on the project.','ordinary_before_memory'));await until(()=>f.requests.length===1,'ordinary work started');
 assert.equal(f.app.store.state.contextCarry.active[f.chatId],recordId,'the ordinary turn uses the prepared handoff');
 await until(()=>f.app.store.state.deskWork.tasks.some(t=>t.memoryHandoff),'memory request queued');assert.equal(f.requests.length,1,'memory request waits behind current work');
 finish(f.requests[0],'PROJECT_RETURN_POINT');await until(()=>f.requests.length===2,'memory author runs next');finish(f.requests[1],'The account remains current.');await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'both tasks completed');
 await f.app.deskTasks.pump();assert.equal(f.requests.length,2);const tasks=f.app.store.state.deskWork.tasks;assert.equal(tasks.filter(t=>t.memoryHandoff).length,1);
 const map=returnMap(f.app.store.state,f.chatId,tasks[0].selection);assert(map.slots.ownWork.lastReply.text.includes('PROJECT_RETURN_POINT'));assert.equal(map.slots.changes.sinceInput,f.app.store.state.returnRecords.supplies[0].id);
 assert(f.app.store.state.deskWork.batches.some(b=>b.memoryHandoff));
 }finally{await f.close();}
});

test('Hat-note writes cannot backflow into their source record, Coat or author controls',()=>{
 const f=setup(),hid=f.hat('Scoped'),other=f.hat('Other');f.chair(f.chatId,f.s.chats[0].seating.desk.id,'Builder',hid);
 f.send('message.note',{chatId:f.chatId,content:'ORIGINAL_SOURCE_UNCHANGED'});const original=structuredClone(f.s.messages),controls=structuredClone(f.s.chats[0].seating),otherBefore=structuredClone(findHat(f.s,other));
 const result=executeReturnWrite(f.s,f.task(),'write_hat_note',{hat_id:hid,note_id:'',revision:'',title:'A note',text:'Text is not a setting or a source edit.',sources:[`message:${f.chatId}:${f.s.messages.at(-1).id}`]});
 assert(result.saved);assert.deepEqual(f.s.messages,original);assert.deepEqual(f.s.chats[0].seating,controls);assert.deepEqual(findHat(f.s,other),otherBefore);assert.equal(hatHead(findHat(f.s,hid)).allowChairIntro,false);
});

test('portable Hat text keeps its captured source sharing even in a different desk',()=>{
 const f=setup(),origin=f.chatId,originRoot=f.rootId,hid=f.hat('Carried scope');
 f.send('root.create',{name:'Receiving desk',mode:'personal'});const receiver=f.s.chats.at(-1);f.send('table.roster.start',{chatId:receiver.id});f.chair(receiver.id,f.s.chats.at(-1).seating.desk.id,'Receiver',hid);
 // Synthetic scoped view, as in the postal sharing fixture: the source was
 // encountered earlier and its destination clearance is now absent.
 const restricted=structuredClone(f.s);restricted.home={settings:[],arrivals:[{rootId:originRoot,at:new Date().toISOString()}],exposures:[]};
 const scope={chatId:origin,homeArrivals:1,homeExposures:0,pc:0,work:0,sketch:0,profiles:[],agentRecords:0};
 restricted.returnRecords.hats[0].revisions[0].materialScopes=[scope];
 const selected=resolveSpeaker(restricted,receiver.id,'personal');
 assert.throws(()=>assertReturnDisclosure(restricted,receiver.id,selected.model,selected.selection,null,null),/Home/);
 const noHat={...selected.selection,chairSnapshot:{...selected.selection.chairSnapshot,hatId:null}};
 assert.doesNotThrow(()=>assertReturnDisclosure(restricted,receiver.id,selected.model,noHat,null,null));
});
