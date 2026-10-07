import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,deferred} from './helpers.mjs';
import {harnessSnapshot} from '../server/harnesses.mjs';
import {usualCoat,resolvedCoat} from '../public/harness-catalog.js';
const ref=id=>({id,version:1});
async function usual(f,id){const key='model:'+f.app.store.state.models[0].id;await f.command('harness.usual',{key,ref:ref(id),baseId:usualCoat(f.app.store.state,key)?.id??null});}
test('usual Coats apply to new branches, preserve pinned overrides and bind in-flight replies to the exact version',async t=>{
 const f=await fixture(t),key='model:'+f.app.store.state.models[0].id;
 await usual(f,'tutor');assert.equal(harnessSnapshot(f.app.store.state,f.chatId).preset.id,'tutor');
 await f.command('harness.branch',{chatId:f.chatId,key,ref:ref('rival'),mode:'override',baseId:null});await usual(f,'brainstorm');assert.equal(harnessSnapshot(f.app.store.state,f.chatId).preset.id,'rival');
 await f.command('chat.create',{rootId:f.rootId,title:'New branch'});const next=f.app.store.state.chats.at(-1);assert.equal(harnessSnapshot(f.app.store.state,next.id).preset.id,'brainstorm');
 const started=deferred(),release=deferred();t.after(()=>release.resolve());f.handler=async(b,res)=>{started.resolve();await release.promise;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Done.'},finish_reason:'stop'}]}));};
 const pending=f.post('/api/exchange',{chatId:next.id,content:'Explain',toolsEnabled:false});await started.promise;await usual(f,'assistant');release.resolve();assert.equal((await pending).status,200);assert.equal(f.app.store.state.exchanges.at(-1).harness.preset.id,'brainstorm');assert.equal(harnessSnapshot(f.app.store.state,next.id).preset.id,'assistant');
 const m=f.app.store.state.models[0];assert.equal((await f.post('/api/command',{type:'model.save',payload:{...m,model:'different'}})).status,400);assert.equal((await f.post('/api/command',{type:'model.save',payload:{...m,model:'different',coatRetarget:'keep'}})).status,200);
});
