import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationMessages} from '../public/conversation-records.js';
import {messageActions} from '../public/message-actions.js';
import {captureDreamSource} from '../server/dream-training-state.mjs';

const state=()=>({chats:[{id:'chat',rootId:'desk'}],messages:[
  {id:'note',chatId:'chat',role:'user',content:'An earlier note.',createdAt:'2026-11-10T01:00:00Z'},
  {id:'fragment',chatId:'chat',role:'user',content:'One chair fragment',exchangeId:'exchange',createdAt:'2026-11-10T01:01:01Z'},
  {id:'reply',chatId:'chat',role:'assistant',content:'A reply.',exchangeId:'exchange',createdAt:'2026-11-10T01:02:00Z'},
  {id:'approach',chatId:'chat',role:'assistant',kind:'parallel',parallelEpisodeId:'job',content:'Another approach.',createdAt:'2026-11-10T01:03:00Z'},
],exchanges:[{id:'exchange',status:'completed',request:{deskTaskId:'task'}}],parallel:{jobs:[{id:'job',status:'completed'}]},deskWork:{batches:[{id:'batch',chatId:'chat',original:'Our shared opening. @Astra Build. @Sol Check.',createdAt:'2026-11-10T01:01:00Z'}],tasks:[]}});

test('message options preserve reply and approach destinations, with fewer actions for user prompts',()=>{
  const s=state();assert.deepEqual(messageActions(s,'batch').map(x=>x.label),['Save as Dream note','Send with Pony Post','Make image']);
  assert.equal(messageActions(s,'reply').find(x=>x.label==='Details').id,'reply');assert.equal(messageActions(s,'reply').find(x=>x.label==='Save as sketch').id,'reply');
  assert.deepEqual(messageActions(s,'approach').find(x=>x.label==='Details'),{label:'Details',action:'parallel-details',id:'job'});
  assert.deepEqual(messageActions(s,'fragment'),[]);
});

test('group Dream marks preserve the exact displayed original and cutoff without chair-fragment duplicates',()=>{
  const s=state();assert.deepEqual(conversationMessages(s,'chat').map(m=>m.id),['note','batch','reply','approach']);
  const source=captureDreamSource(s,{kind:'message',chatId:'chat',messageIds:['batch']});
  assert.deepEqual(source.selectedIds,['batch']);assert.deepEqual(source.messages.map(m=>m.id),['note','batch']);assert.equal(source.messages[1].deskBatchId,'batch');
  assert.equal(source.messages[1].content,s.deskWork.batches[0].original);assert(!source.text.includes('One chair fragment'));assert(!source.text.includes('A reply.'));
  const passage=captureDreamSource(s,{kind:'passage',chatId:'chat',messageIds:['batch','reply'],text:'Our shared opening. A reply.'});assert.deepEqual(passage.selectedIds,['batch','reply']);
});
