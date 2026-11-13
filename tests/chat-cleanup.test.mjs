import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input,until,finish} from './desk-helpers.mjs';
import {conversationMessages,unsentRequestFailures} from '../public/conversation-records.js';
import {replayJournal} from '../server/journal.mjs';

test('discard removes an unsent failure and matching draft, preserves its record and unrelated typing, and survives reopening',async()=>{
 const f=await fixture();try{
 f.app.deskTasks.execute=async()=>{throw new Error('Synthetic failure before a model exchange.');};
 const batch=await f.app.deskTasks.admit(input(f,'An old request.'));
 await until(()=>f.app.store.state.deskWork.tasks[0].status==='failed','failure recorded');
 const task=structuredClone(f.app.store.state.deskWork.tasks[0]);assert.equal(task.exchangeId,null);
 await f.command('draft.save',{chatId:f.chatId,text:'An old request.'});
 await f.command('desk.discardUnsent',{batchId:batch.batchId});
 assert(!conversationMessages(f.app.store.state,f.chatId).some(m=>m.id===batch.batchId));assert.equal(f.app.store.state.drafts[f.chatId],undefined);
 assert.deepEqual(f.app.store.state.deskWork.tasks[0],task);assert.equal(f.app.store.state.deskWork.events.at(-1).author.chair,'You');
 await f.command('draft.save',{chatId:f.chatId,text:'A new message I am still writing.'});
 await f.command('desk.discardUnsent',{batchId:batch.batchId});
 assert.equal(f.app.store.state.drafts[f.chatId],'A new message I am still writing.');assert.equal(f.app.store.state.deskWork.events.filter(e=>e.kind==='task.discarded').length,1);
 const reopened=await replayJournal(f.app.store.file);assert(!conversationMessages(reopened.state,f.chatId).length);assert.equal(reopened.state.drafts[f.chatId],'A new message I am still writing.');assert.equal(f.requests.length,0);
 }finally{await f.close();}
});
test('discard never removes a delivered group, and a mixed group retains its successful request',async()=>{
 const f=await fixture();try{
 const execute=f.app.deskTasks.execute;f.app.deskTasks.execute=(body,...rest)=>body.content.includes('Fail')?Promise.reject(new Error('Synthetic pre-dispatch failure.')):execute(body,...rest);
 const group=await f.app.deskTasks.admit(input(f,'@hearthline Fail before dispatch. @qwen Answer normally.'));
 await until(()=>f.requests.length===1,'one model request');finish(f.requests[0],'A real recorded answer.');
 await until(()=>f.app.store.state.deskWork.tasks.every(t=>['failed','completed'].includes(t.status)),'mixed group finished');
 await f.command('desk.discardUnsent',{batchId:group.batchId});
 const messages=conversationMessages(f.app.store.state,f.chatId);assert(messages.some(m=>m.id===group.batchId));assert(messages.some(m=>m.content==='A real recorded answer.'));assert.equal(unsentRequestFailures(f.app.store.state,group.batchId).length,0);
 const next=await f.app.deskTasks.admit(input(f,'One more normal request.','another_request'));await until(()=>f.requests.length===2,'normal request');
 await assert.rejects(f.command('desk.discardUnsent',{batchId:next.batchId}),/reached a model|pending/);finish(f.requests[1]);
 }finally{await f.close();}
});
