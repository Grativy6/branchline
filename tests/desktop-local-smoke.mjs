// Explicit real stock-Qwen qualification. Synthetic workspace; no external accounts.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {listen} from './helpers.mjs';
import {turnOptions} from '../public/table.js';
import {activeCarry,readyCarry,readChatSource} from '../server/context-carry.mjs';
import {RESOURCE_DEFAULTS} from '../public/resource-settings.js';
const bundle=path.resolve(process.argv[2]), output=path.resolve(process.argv[3]);
await fs.mkdir(output,{recursive:true});
const dir=await fs.mkdtemp(path.join(output,'synthetic-local-'));
const app=await createApp({dataDir:path.join(dir,'workspace'),backupDir:path.join(dir,'backups'),bundledDir:bundle});
const url=await listen(app), headers={'x-branchline-session':app.sessionToken,'content-type':'application/json'};
const report={status:'RUNNING',kind:'REAL_STOCK_QWEN',workspace:dir,checks:[],replies:[]};
const save=()=>fs.writeFile(path.join(output,'local-model.json'),JSON.stringify(report,null,2)+'\n');
const call=async(route,body)=>{const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
const command=async(type,payload)=>{const r=await call('/api/command',{type,payload});assert.equal(r.status,200,r.body.error);return r.body;};
try {
 let state=app.store.state;const chatId=state.chats[0].id,rootId=state.roots[0].id;
 const send=async(content,seat='personal')=>{
  const before=app.store.state,start=Date.now();
  const r=await call('/api/exchange',{chatId,content,...turnOptions(before,before.chats.find(c=>c.id===chatId),seat,'send')});
  report.replies.push({content,status:r.status,error:r.body.error,text:app.store.state.messages.filter(m=>m.role==='assistant').at(-1)?.content,elapsedMs:Date.now()-start,metrics:app.store.state.exchanges.at(-1)?.metrics});await save();return r;
 };
 await command('message.note',{chatId,content:'Synthetic project Lantern. Iris suggested red for the shelf. The user corrected it to BLUE and adopted that decision. Whether the pot should be square or round remains unresolved. No purchase permission was given.'});
 for(let i=0;i<19;i++)await command('message.note',{chatId,content:'Workshop observation '+i+'. '+ 'A shelf holds empty pots while the central bench remains clear. These repeated observations add no new decisions. '.repeat(7)});
 await command('draft.save',{chatId,text:'PRESERVED_UNSENT: ask about the pot later.'});
 const original=structuredClone(app.store.state.messages),coat=structuredClone(app.store.state.chats[0].harnessSelections??null);
 const blocked=await send('What color is the shelf?');assert.equal(blocked.status,400);assert.match(blocked.body.error,/context limit|working-context limit/);report.checks.push('An overfull real bundled-model route is held before inference and preserves the draft.');
 const start=Date.now();const prepared=await call('/api/context-carry/prepare',{chatId,speaker:'personal',baseId:null,lastMessageId:app.store.state.messages.at(-1).id});
 report.preparation={status:prepared.status,error:prepared.body.error,elapsedMs:Date.now()-start,account:readyCarry(app.store.state,chatId)?.text,job:app.store.state.contextCarry?.jobs.at(-1)};await save();assert.equal(prepared.status,200,prepared.body.error);
 assert.equal(activeCarry(app.store.state,chatId),null);assert.deepEqual(app.store.state.messages,original);
 await command('message.note',{chatId,content:'A NEWER correction: the shelf is now GREEN. The pot shape is still unresolved. Earlier blue was superseded. No purchases.'});
 const next=await send('Give the latest shelf color, who corrected the older color, the adopted decision, and the unresolved question. Do not guess a pot shape.');assert.equal(next.status,200,next.body.error);
 assert(activeCarry(app.store.state,chatId));assert.equal(readyCarry(app.store.state,chatId),null);assert.equal(app.store.state.drafts[chatId],'PRESERVED_UNSENT: ask about the pot later.');assert.deepEqual(app.store.state.messages.slice(0,original.length),original);
 assert.match(report.replies.at(-1).text,/green/i);assert.match(report.replies.at(-1).text,/pot|shape/i);
 report.checks.push('Real Qwen wrote a source-bound handoff and answered after next-reply activation with the newer green correction and open pot question.');
 const source=readChatSource(app.store.state,chatId,'M1');assert(source.text.includes('Iris'));report.source={id:source.sourceId,hash:source.hash};
 const m=app.store.state.models[0];await command('model.save',{...Object.fromEntries(Object.entries(m).filter(([k])=>k!=='id')),name:'Stock Qwen second connection'});
 const chat=app.store.state.chats.find(c=>c.id===chatId),a=chat.table.assignments.at(-1);await command('table.assign',{chatId,baseRevisionId:a.id,personalId:a.personalId,visitorModelId:app.store.state.models.at(-1).id});
 const switched=await send('Continue from our shared account. State the latest shelf color and unresolved pot choice.','visiting');assert.equal(switched.status,200,switched.body.error);assert.match(report.replies.at(-1).text,/green/i);assert.deepEqual(app.store.state.chats[0].harnessSelections??null,coat);
 report.checks.push('Intentional chair/connection change on the same stock weights retains Coat, corrected fact and sources; different model weights use fixtures only.');
 await command('chat.create',{rootId,title:'Long reply qualification',setupChairs:true});const longChat=app.store.state.chats.at(-1);
 await command('root.resources',{id:rootId,resources:{...RESOURCE_DEFAULTS,replyTokens:2048}});
 const long=await call('/api/exchange',{chatId:longChat.id,content:'Write a numbered list from 1 to 35. For each number, write one complete, practical sentence of at least fifteen words about organizing an imaginary workshop. Complete all thirty-five entries.',...turnOptions(app.store.state,longChat,'personal','send')});
 assert.equal(long.status,200,long.body.error);const ex=app.store.state.exchanges.at(-1);report.longReply={metrics:ex.metrics,finishReason:ex.finishReason,text:app.store.state.messages.at(-1).content};await save();assert(ex.metrics.outputTokens>512,'The real model must exceed the retired short cap.');report.checks.push('Real reply exceeded 512 output tokens.');
 report.runner=app.localRunner.status();report.status='PASS';
 report.meaningReview='Requires human inspection of saved real outputs; structural checks do not certify every generated claim.';
} catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await app.dispose();report.runnerStopped=app.localRunner.child===null;await save();console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,report:path.join(output,'local-model.json')}));}
