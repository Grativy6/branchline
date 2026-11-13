import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyCommand,appendExchange,finishExchange,validateState} from '../server/domain.mjs';
import {configureBundledModel} from '../server/bundled-setup.mjs';
import {beginCarry,parseCarryResult,completeCarry,continueFromHandoff,applyCarryCommand,readChatSource,workingMessages,workingWindow,preserveCarryHistory,activateReadyCarry} from '../server/context-carry.mjs';
import {recordHandoff,prepareModelHandoff,receiveModelOutput,assertModelInvocation} from '../server/handoff.mjs';
import {writeDrawer} from '../server/desk-work.mjs';
import {resolveSpeaker} from '../server/table.mjs';
import {compileMessages} from '../server/model.mjs';

function prepared(){
 let s=configureBundledModel(initialState(),{fresh:true});const chatId=s.chats[0].id;s=applyCommand(s,{type:'table.roster.start',payload:{chatId}});
 for(let i=0;i<12;i++)s=applyCommand(s,{type:'message.note',payload:{chatId,content:`Original ${i}: `+'Saved evidence and next steps. '.repeat(70)}});
 const {job}=beginCarry(s,{chatId,speaker:'personal',baseId:null,lastMessageId:s.messages.at(-1).id},{maxContextCharacters:200000});
 completeCarry(s,job.id,{result:parseCarryResult(s,job,JSON.stringify({account:'Continue the existing project using its saved files. [M1]'}))});
 const {selection,model}=resolveSpeaker(s,chatId,'personal');
 return {s,chatId,selection,model,recordId:s.contextCarry.records[0].id};
}
function exchange(f,id,body,size=0,complete=true){
 f.s=appendExchange(f.s,f.chatId,{id,modelId:f.model.id,content:'Inspect the project '+id,speaker:f.selection});
 if(size)recordHandoff(f.s,{kind:'operation.result',taskId:id,scope:{rootId:f.s.roots[0].id,chatId:f.chatId},from:'tool',to:'model',payload:body,detail:{toolProfile:'synthetic_fixture',tool:'read_pc_text',result:{ok:true,value:{text:body+'x'.repeat(size)}}}});
 if(complete)f.s=finishExchange(f.s,id,{status:'completed',content:'The work is saved in project.html.'});
 return f;
}
const input=f=>compileMessages(f.s,f.chatId,'Continue the assignment.',{selection:f.selection,maxContextCharacters:2000000});
const start=f=>continueFromHandoff(f.s,{chatId:f.chatId,baseId:f.s.contextCarry.active[f.chatId]??null,recordId:f.recordId,lastMessageId:f.s.messages.at(-1).id});

test('Continue removes a tool-heavy tail while preserving full sources, guidance, drawer and color',()=>{
 const f=exchange(prepared(),'exchange_heavy','EXACT_OLD_TOOL_BODY ',624000);
 f.s.roots[0].instructions.push({id:'instruction_fixture',createdAt:new Date().toISOString(),text:'Keep the current project purpose.'});
 f.s.coatOptions={conversation:{color:'#2583df',thinking:false,thinkingContextCharacters:4000}};
 writeDrawer(f.s,{id:'drawer_test',chatId:f.chatId,chairId:f.selection.chairId,label:'Qwen',selection:f.selection,model:f.model},{name:'Return note',text:'KEEP_DRAWER_CONTEXT',revision:''});
 const before=input(f),original=JSON.stringify({messages:f.s.messages,exchanges:f.s.exchanges,records:f.s.handoffs.records,colors:f.s.coatOptions,drawers:f.s.deskWork.drawers});
 assert(before.some(m=>m.content.includes('EXACT_OLD_TOOL_BODY')));start(f);validateState(f.s);
 const after=input(f);assert(after.reduce((n,m)=>n+m.content.length,0)<30000);assert(!after.some(m=>m.content.includes('EXACT_OLD_TOOL_BODY')));
 assert(after.some(m=>m.content.includes('Keep the current project purpose.')));assert(after.some(m=>m.content.includes('project.html')));assert(after.some(m=>m.content.includes('KEEP_DRAWER_CONTEXT')));
 assert.equal(JSON.stringify({messages:f.s.messages,exchanges:f.s.exchanges,records:f.s.handoffs.records,colors:f.s.coatOptions,drawers:f.s.deskWork.drawers}),original);
 assert(readChatSource(f.s,f.chatId,'M14').text.includes('EXACT_OLD_TOOL_BODY'));
 assert.equal(readChatSource(f.s,f.chatId,'M14',620000).nextOffset,null);
 const reopened=JSON.parse(JSON.stringify(f.s));validateState(reopened);assert.deepEqual(workingWindow(reopened,f.chatId),workingWindow(f.s,f.chatId));
 assert.deepEqual(compileMessages(reopened,f.chatId,'Continue the assignment.',{selection:f.selection,maxContextCharacters:2000000}),after);
 const count=f.s.contextCarry.windows.length;start(f);assert.equal(f.s.contextCarry.windows.length,count);
});
test('later completed tool results use source handles, and full history can be restored',()=>{
 const f=exchange(prepared(),'exchange_old','OLD_TOOL ',80000);start(f);
 exchange(f,'exchange_later','FUTURE_TOOL ',120000);
 const next=input(f);assert(next.some(m=>m.content.includes('Earlier tool receipts')));assert(!next.some(m=>m.content.includes('FUTURE_TOOL')));
 assert(readChatSource(f.s,f.chatId,'M16').text.includes('FUTURE_TOOL'));
 applyCarryCommand(f.s,'carry.select',{chatId:f.chatId,baseId:f.recordId,recordId:null});assert.equal(workingWindow(f.s,f.chatId),null);
 const full=input(f);assert(full.some(m=>m.content.includes('OLD_TOOL')));assert(full.some(m=>m.content.includes('FUTURE_TOOL')));validateState(f.s);
});
test('new arrivals and running work survive the boundary; the running request retains its captured input',()=>{
 const f=exchange(prepared(),'exchange_running','',0,false),cutoff=f.s.messages.at(-1).id;
 const messages=input(f),h=prepareModelHandoff(f.s,{taskId:'exchange_running',chatId:f.chatId,kind:'reply',messages,purpose:'Continuing synthetic work.',selection:f.selection});assertModelInvocation(h,messages,f.model);
 f.s.messages.push({...f.s.messages[0],id:'message_arrived',createdAt:new Date().toISOString(),content:'NEW_MESSAGE_AFTER_PREVIEW'});
 continueFromHandoff(f.s,{chatId:f.chatId,baseId:null,recordId:f.recordId,lastMessageId:cutoff});
 receiveModelOutput(f.s,h,'RUNNING_RESULT_RETAINED');assert.equal(f.s.handoffs.records.at(-1).status,'WITHIN_LOCAL_PROFILE',JSON.stringify(f.s.handoffs.records.at(-1)));
 f.s=finishExchange(f.s,'exchange_running',{status:'completed',content:'RUNNING_RESULT_RETAINED'});
 const later=workingMessages(f.s,f.chatId).map(x=>x.message.content).join('\n');
 assert(later.includes('Inspect the project exchange_running'));assert(later.includes('RUNNING_RESULT_RETAINED'));assert(later.includes('NEW_MESSAGE_AFTER_PREVIEW'));validateState(f.s);
 for(let i=0;i<12;i++)f.s=applyCommand(f.s,{type:'message.note',payload:{chatId:f.chatId,content:'Later work '+i+' '+'Saved progress. '.repeat(160)}});
 const {job}=beginCarry(f.s,{chatId:f.chatId,speaker:'personal',baseId:f.recordId,lastMessageId:f.s.messages.at(-1).id},{maxContextCharacters:200000});
 completeCarry(f.s,job.id,{result:parseCarryResult(f.s,job,JSON.stringify({account:'The running work finished; continue from later progress. [M1]'}))});activateReadyCarry(f.s,f.chatId);
 assert(!workingMessages(f.s,f.chatId).some(x=>x.message.exchangeId==='exchange_running'));validateState(f.s);
});
test('working boundaries cannot cross conversations or rewrite earlier boundary records',()=>{
 const f=prepared();start(f);const before=structuredClone(f.s);
 assert.throws(()=>continueFromHandoff(f.s,{chatId:'another_chat',baseId:null,recordId:f.recordId,lastMessageId:f.s.messages.at(-1).id}));
 const changed=structuredClone(f.s);changed.contextCarry.windows[0].throughSourceId='M9999';assert.throws(()=>validateState(changed));assert.throws(()=>preserveCarryHistory(before,changed));
});
