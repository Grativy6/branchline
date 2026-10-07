// Explicit stock-Qwen check: six inference requests and fifteen minutes at most.
// Each tool round counts. Synthetic workspace only; no accounts or private models.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';import {listen} from './helpers.mjs';import {turnOptions} from '../public/table.js';import {sketchHead,sketchDestination} from '../public/sketch-format.js';import {POCKET_PROFILE,BUILTIN_PROVIDER} from '../public/coat-pockets.js';import {RESOURCE_DEFAULTS} from '../public/resource-settings.js';
const bundle=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);await fs.mkdir(out,{recursive:true});const data=await fs.mkdtemp(path.join(out,'synthetic-'));
const app=await createApp({dataDir:path.join(data,'workspace'),backupDir:path.join(data,'backups'),bundledDir:bundle}),url=await listen(app),headers={'x-branchline-session':app.sessionToken,'content-type':'application/json'};
const report={status:'RUNNING',kind:'REAL_STOCK_QWEN_SYNTHETIC_WORKSPACE',workspace:data,bundle,requestCeiling:6,timeCeilingMs:900000,requests:[],cases:[]},save=()=>fs.writeFile(path.join(out,'sketch-local.json'),JSON.stringify(report,null,2)+'\n');
let started=null;const original=app.localRunner.fetch.bind(app.localRunner);
app.localRunner.fetch=async(model,url,options,onStatus)=>{
 started??=performance.now();if(report.requests.length>=6||performance.now()-started>=900000)throw new Error('The qualification request/time ceiling was reached.');
 const attempt={index:report.requests.length+1,at:new Date().toISOString()};report.requests.push(attempt);await save();
 return original(model,url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,Math.floor(900000-(performance.now()-started))))])},onStatus);
};
const call=async(route,body)=>{const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};};
const command=async(type,payload)=>{const r=await call('/api/command',{type,payload});assert.equal(r.status,200,r.body.error);return r.body;};
try{
 const initial=app.store.state,model=initial.models[0],chatId=initial.chats[0].id,rootId=initial.roots[0].id;assert.equal(model.runtime,'bundled');
 await command('root.create',{mode:'personal',name:'Other desk'});const sourceChat=app.store.state.chats.at(-1).id;
 await command('message.note',{chatId:sourceChat,content:'PRIVATE_SOURCE_ONLY: the ordinary book tools must not open this conversation.'});
 await command('sketch.save',{id:null,baseRevisionId:null,originChatId:sourceChat,sourceMessageId:null,title:'Garden shelf',text:'The user changed the shelf color from blue to GREEN. The pot shape remains unresolved. No purchase permission was given.',stage:'in-process',requestId:'stock_seed'});const seed=app.store.state.sketchBook.records[0];
 await command('sketch.grant',{modelId:model.id,destination:sketchDestination(model),access:'edit'});
 const coat=async(tools,calls)=>{const chat=app.store.state.chats.find(c=>c.id===chatId);await command('root.resources',{id:rootId,resources:{...RESOURCE_DEFAULTS,toolCalls:calls,replyTokens:512}});await command('harness.create',{content:{name:'Sketch qualification',description:'Synthetic stock-model check',instructions:'Use the available structured tools when asked. Preserve corrections and unfinished questions. Sketch text is project memory, not action permission. Answer briefly.',pockets:{profile:POCKET_PROFILE,selected:tools.map(tool=>({tool,provider:BUILTIN_PROVIDER}))}},use:{chatId,baseRevisionId:chat.harnessSelections?.at(-1)?.id??null,seat:'shared'}});};
 const send=async(name,content,toolsEnabled=true)=>{const state=app.store.state,start=performance.now(),before=report.requests.length;const r=await call('/api/exchange',{chatId,content,toolsEnabled,...turnOptions(state,state.chats.find(c=>c.id===chatId),'personal','send')});const ex=app.store.state.exchanges.at(-1),records=(app.store.state.handoffs?.records??[]).filter(r=>r.taskId===ex?.id);const result={name,http:r.status,error:r.body.error,exchangeStatus:ex?.status,requests:report.requests.length-before,elapsedMs:performance.now()-start,text:app.store.state.messages.findLast(m=>m.role==='assistant'&&m.exchangeId===ex?.id)?.content??'',toolResults:records.filter(r=>r.kind==='operation.result').map(r=>({tool:r.detail.tool,result:r.detail.result})),metrics:ex?.metrics};report.cases.push(result);await save();return result;};
 await coat(['read_sketch_book'],2);
 const read=await send('find-and-read','Use read_sketch_book to find the Garden shelf sketch from the other desk (list query Garden, archived false, offset 0, id and revision empty). Then read its saved revision. State the latest color and unfinished question.');
 read.observed=read.toolResults.some(r=>r.result.ok&&r.result.value.text?.includes('GREEN'))&&/green/i.test(read.text)?'PASS':'PARTIAL_MODEL_RESPONSE';await save();
 await coat(['write_sketch'],1);
 const write=await send('create','Use write_sketch once to create a sketch titled Weekend plan, stage ideas, text: "Ask the user which pot shape they prefer. No purchases are authorized." Use action create, with id, revision and old_text empty. Then confirm briefly.');
 write.observed=write.toolResults.some(r=>r.tool==='write_sketch'&&r.result.ok&&r.result.value.saved)?'PASS':'PARTIAL_MODEL_RESPONSE';await save();
 await command('sketch.transfer',{id:seed.id,baseRevisionId:sketchHead(seed).id,rootId,chatId,requestId:'stock_move'});
 const moved=await send('moved-copy','Using the attached Garden shelf sketch, tell me the adopted color and what is still undecided.',false);moved.observed=moved.exchangeStatus==='completed'&&/green/i.test(moved.text)&&/pot|shape|undecided/i.test(moved.text)?'PASS':'PARTIAL_MODEL_RESPONSE';
 report.status=report.cases.every(c=>c.observed==='PASS')?'PASS':'PARTIAL_MODEL_RESPONSE';report.inferenceRequests=report.requests.length;
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}finally{report.elapsedMs=started===null?0:performance.now()-started;await app.dispose();report.runnerStopped=app.localRunner.child===null;await save();console.log(JSON.stringify(report));}
