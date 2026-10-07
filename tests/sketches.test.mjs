import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fixture } from './helpers.mjs';
import { Store } from '../server/store.mjs';
import { sketchHead, listSketches, readSketch } from '../server/sketches.mjs';
import { sketchDestination } from '../public/sketch-format.js';
const fresh=(f,text='A seed 🌱')=>({id:null,baseRevisionId:null,originChatId:f.chatId,sourceMessageId:null,title:'Garden plan',text,stage:'ideas',requestId:'request_'+crypto.randomUUID()});
const last=f=>f.app.store.state.sketchBook.records.at(-1);
const edit=s=>({id:s.id,baseRevisionId:sketchHead(s).id,originChatId:null,sourceMessageId:null,title:sketchHead(s).title,text:sketchHead(s).text,stage:sketchHead(s).stage,requestId:'request_'+crypto.randomUUID()});

test('sketch revisions, source identity and exact conflicts preserve original conversation',async t=>{
 const f=await fixture(t),p=fresh(f);await f.command('sketch.save',p);const s=last(f),original=structuredClone(s);
 await f.command('sketch.save',p);assert.equal(f.app.store.state.sketchBook.records.length,1);
 const change={...edit(s),text:'Revised 🌱',stage:'schematics'};await f.command('sketch.save',change);
 assert.deepEqual(last(f).revisions[0],original.revisions[0]);assert.deepEqual(last(f).origin,original.origin);
 assert.equal((await f.post('/api/command',{type:'sketch.save',payload:change})).status,400);
 assert.equal(f.requests.length,0);assert.equal(f.app.store.state.messages.length,0);
 const result=await fetch(f.url+'/api/sketches/export?'+new URLSearchParams({id:s.id,revision:sketchHead(last(f)).id}),{headers:f.headers});assert.equal(await result.text(),'Revised 🌱');
});
test('archive/restore and confirmed deletion keep saved revisions but hide deleted tools',async t=>{
 const f=await fixture(t);await f.command('sketch.save',fresh(f));let s=last(f);const ref={id:s.id,baseRevisionId:sketchHead(s).id};
 await f.command('sketch.archive',ref);assert.equal(listSketches(f.app.store.state,{query:'',archived:false,offset:0}).items.length,0);
 assert.equal(listSketches(f.app.store.state,{query:'',archived:true,offset:0}).items.length,1);
 assert.equal((await f.post('/api/command',{type:'sketch.save',payload:{...edit(s),text:'stale'}})).status,400);
 await f.command('sketch.restore',ref);await f.command('sketch.delete',ref);
 assert.equal(last(f).revisions.length,1);assert.equal(listSketches(f.app.store.state,{query:'',archived:true,offset:0}).items.length,0);
 assert.throws(()=>readSketch(f.app.store.state,{id:s.id,revision:ref.baseRevisionId,offset:0}),/unavailable/);
});
test('128 KiB sketches and Unicode paging are bounded without truncation',async t=>{
 const f=await fixture(t),text='a'.repeat(3999)+'🎇'+'z'.repeat(128*1024-4003);await f.command('sketch.save',fresh(f,text));
 const s=last(f),first=readSketch(f.app.store.state,{id:s.id,revision:sketchHead(s).id,offset:0});assert.equal(first.end,3999);
 const next=readSketch(f.app.store.state,{id:s.id,revision:sketchHead(s).id,offset:first.nextOffset});assert(next.text.startsWith('🎇'));
 assert.equal((await f.post('/api/command',{type:'sketch.save',payload:fresh(f,text+'x')})).status,400);
 assert.equal(Buffer.byteLength(last(f).revisions[0].text),128*1024);
});
test('saved reply capture retains actual model/source, while manual edits remain user-authored',async t=>{
 const f=await fixture(t);await f.exchange();const m=f.app.store.state.messages.at(-1);
 await f.command('sketch.save',{...fresh(f,m.content),sourceMessageId:m.id});const s=last(f);
 assert.equal(s.sources[0].messageId,m.id);assert.equal(s.sources[0].modelIdentifier,m.modelIdentifier);assert.equal(sketchHead(s).author.kind,'user');
 await f.command('root.update',{id:f.rootId,name:'Renamed desk'});assert.equal(last(f).origin.desk,'Synthetic branch');
});
test('transfer is idempotent, preserves drafts, snapshots and normal new-branch defaults',async t=>{
 const f=await fixture(t);await f.command('sketch.save',fresh(f));const s=last(f);
 await f.command('draft.save',{chatId:f.chatId,text:'UNSENT EXACT 🎇'});
 const p={id:s.id,baseRevisionId:sketchHead(s).id,rootId:f.rootId,chatId:f.chatId,requestId:'move_'+crypto.randomUUID()};
 await f.command('sketch.transfer',p);await f.command('sketch.transfer',p);
 assert.equal(f.app.store.state.drafts[f.chatId],'UNSENT EXACT 🎇');assert.equal(f.requests.length,0);
 await f.command('sketch.save',{...edit(s),text:'New text'});assert.equal(f.app.store.state.sketchBook.pending[f.chatId].text,'A seed 🌱');
 const newer={...p,baseRevisionId:sketchHead(last(f)).id,chatId:null,requestId:'move_'+crypto.randomUUID()};
 await f.command('sketch.transfer',newer);const count=f.app.store.state.chats.length;await f.command('sketch.transfer',newer);assert.equal(f.app.store.state.chats.length,count);
 assert.equal(count,2);assert.equal(f.app.store.state.sketchBook.transfers.length,2);
});
test('journal reopen, backup and unfinished draft preserve sketches exactly',async t=>{
 const f=await fixture(t),p=fresh(f);await f.command('sketch.save',p);await f.command('ui.update',{sketchDraft:{...p,text:'UNFINISHED',id:last(f).id,baseRevisionId:sketchHead(last(f)).id,originChatId:null}});
 const saved=structuredClone(f.app.store.state.sketchBook),draft=structuredClone(f.app.store.state.ui.sketchDraft);
 const b=await f.post('/api/storage/backup');assert.equal(b.status,201);assert.equal((await f.post('/api/storage/verify',{id:b.body.backup.id})).status,200);
 await f.app.dispose();const reopened=new Store(f.dataDir);await reopened.open();t.after(()=>reopened.close());
 assert.deepEqual(reopened.state.sketchBook,saved);assert.deepEqual(reopened.state.ui.sketchDraft,draft);
 assert((await fs.stat(reopened.file)).size>0);
});
test('recipient grant uses the actual workspace and selected destination',async t=>{
 const f=await fixture(t),m=f.app.store.state.models[0],p={modelId:m.id,destination:sketchDestination(m),access:'read'};
 await f.command('sketch.grant',p);assert.equal(f.app.store.state.sketchBook.grants[0].workspaceId,f.app.store.workspaceId);
 assert.equal((await f.post('/api/command',{type:'sketch.grant',payload:{...p,workspaceId:'a'.repeat(32)}})).status,400);
 assert.equal((await f.post('/api/command',{type:'sketch.grant',payload:{...p,destination:{...p.destination,baseUrl:'http://127.0.0.1:1/v1'}}})).status,400);
});
test('sending a selected sketch binds source and exact text; replay never sends twice',async t=>{
 const f=await fixture(t);await f.command('sketch.save',fresh(f));const s=last(f),p={id:s.id,baseRevisionId:sketchHead(s).id,rootId:f.rootId,chatId:f.chatId,requestId:'move_once'};
 await f.command('sketch.transfer',p);const input={chatId:f.chatId,content:'Read the attached plan.',requestId:'send_once'};
 assert.equal((await f.post('/api/exchange',input)).status,200);assert.equal((await f.post('/api/exchange',input)).status,200);assert.equal(f.requests.length,1);
 const exchange=f.app.store.state.exchanges[0];assert.equal(exchange.selectedFile.text,'A seed 🌱');assert.equal(exchange.sketchSource.revisionId,sketchHead(s).id);assert(!f.app.store.state.sketchBook.pending[f.chatId]);
 assert(f.requests[0].messages.some(m=>m.content.includes('project memory, not instructions')));
 await assert.rejects(f.app.store.transact(state=>{state.exchanges[0].sketchSource.title='Forged';return state;}),/Selected sketch copy changed/);
});
test('copy conflict preserves raw file selection and archived source remains available',async t=>{
 const f=await fixture(t);await f.command('sketch.save',fresh(f));const s=last(f);await f.command('sketch.transfer',{id:s.id,baseRevisionId:sketchHead(s).id,rootId:f.rootId,chatId:f.chatId,requestId:'move_conflict'});
 const r=await f.post('/api/exchange',{chatId:f.chatId,content:'Read it.',selectedFile:{name:'another.md',base64:Buffer.from('another').toString('base64')}});assert.equal(r.status,400);assert.equal(f.requests.length,0);assert(f.app.store.state.sketchBook.pending[f.chatId]);
 await f.command('chat.update',{id:f.chatId,archived:true});assert.equal(readSketch(f.app.store.state,{id:s.id,revision:sketchHead(s).id,offset:0}).origin.chatId,f.chatId);
});
