import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyCommand,validateState} from '../server/domain.mjs';
import {configureBundledModel} from '../server/bundled-setup.mjs';
import {beginCarry,parseCarryResult,completeCarry,carryBasis,carryJobCurrent,activateReadyCarry,applyCarryCommand} from '../server/context-carry.mjs';
import {compileMessages,measureContext} from '../server/model.mjs';
import {resolveSpeaker} from '../server/table.mjs';
import {prepareModelHandoff,assertModelInvocation,receiveModelOutput} from '../server/handoff.mjs';

function prepared({legacy=false}={}){
 let s=configureBundledModel(initialState(),{fresh:true});const chatId=s.chats[0].id;
 for(let i=0;i<30;i++)s=applyCommand(s,{type:'message.note',payload:{chatId,content:`Original ${i}: `+'A continuing project has saved evidence and a next step. '.repeat(35)}});
 s.chats[0].contextPolicy=2;
 const {job}=beginCarry(s,{chatId,speaker:'personal',baseId:null,lastMessageId:s.messages.at(-1).id},{maxContextCharacters:200000});
 if(legacy){job.basisProfile='branch-inputs/2';job.basis=carryBasis(s,chatId,'branch-inputs/2');}
 completeCarry(s,job.id,{result:parseCarryResult(s,job,JSON.stringify({account:'Continue the existing project from its saved evidence. [M1]'}))});
 return {s,chatId,job,record:s.contextCarry.records.at(-1)};
}
test('saving a resource ceiling does not invalidate a legacy default-resource handoff',()=>{
 const {s,chatId,job,record}=prepared({legacy:true}),messages=JSON.stringify(s.messages);
 s.roots[0].resources={replyTokens:null,inputCharacters:2000000,fileBytes:131072,toolCalls:32,toolResultBytes:160000,replySeconds:300,handoffSeconds:300};
 assert(carryJobCurrent(s,job));assert.equal(activateReadyCarry(s,chatId).id,record.id);assert.equal(JSON.stringify(s.messages),messages);validateState(s);
});
test('new handoffs ignore resource adjustments but still bind their original guidance',()=>{
 const {s,chatId,job}=prepared();s.roots[0].resources={inputCharacters:2000000};assert(carryJobCurrent(s,job));
 s.chats[0].responseMode='work';assert(!carryJobCurrent(s,job));assert.throws(()=>activateReadyCarry(s,chatId),/different guidance/);
});
test('using a prepared handoff reduces effective input even when full history would fit',()=>{
 const {s,chatId,record}=prepared(),{selection}=resolveSpeaker(s,chatId,'personal');
 const before=measureContext(s,chatId,'Continue.',{selection}).characters;
 applyCarryCommand(s,'carry.select',{chatId,baseId:null,recordId:record.id});
 assert.equal(s.contextCarry.ready[chatId],undefined);
 const after=measureContext(s,chatId,'Continue.',{selection}).characters;assert(after<before/2,{before,after});
 assert(compileMessages(s,chatId,'Continue.',{selection,maxContextCharacters:1000000}).some(m=>m.content.includes(record.text)));validateState(s);
});
test('an in-flight reply retains its captured account when a prepared handoff is selected',()=>{
 const {s,chatId,record}=prepared(),{selection,model}=resolveSpeaker(s,chatId,'personal');
 const messages=compileMessages(s,chatId,'Continue.',{selection,maxContextCharacters:1000000});
 const h=prepareModelHandoff(s,{taskId:'exchange_context_fixture',chatId,kind:'reply',messages,purpose:'Synthetic continuing work.',selection});
 assertModelInvocation(h,messages,model);
 applyCarryCommand(s,'carry.select',{chatId,baseId:null,recordId:record.id});
 receiveModelOutput(s,h,'The captured reply is complete.');
 const received=s.handoffs.records.findLast(r=>r.kind==='model.to_record');assert.equal(received.status,'WITHIN_LOCAL_PROFILE');
});
