import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/index.mjs';
import { applyCommand } from '../server/domain.mjs';
export async function fixture({hold=true,reply=null,modelOptions={},codex={close(){},async status(){return {connected:false,models:[],pending:false};}}}={}){
  const requests=[];
  const fake=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const body=JSON.parse(text);requests.push({body,res,at:Date.now()});if(reply)await reply(requests.at(-1),requests);else if(!hold)finish(requests.at(-1));});
  await new Promise(r=>fake.listen(0,'127.0.0.1',r));
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-desk-test-'));
  const app=await createApp({dataDir:path.join(dir,'workspace'),bundledDir:path.join(dir,'no-model'),modelOptions:{codex,hardwareMeter:{async sample(){return {sampledAt:new Date().toISOString(),scope:'whole_device',cpu:{utilizationPercent:25,logicalProcessors:8},memory:{usedBytes:4*1073741824,totalBytes:16*1073741824},gpus:[{id:'fixture-gpu',name:'Fixture GPU',utilizationPercent:30,usedBytes:2*1073741824,totalBytes:8*1073741824,scope:'whole_device',source:'Synthetic fixture'}],gpuError:null};}},...modelOptions}});
  const command=async(type,payload)=>app.store.transact(s=>applyCommand(s,{type,payload}));
  await command('root.create',{name:'Test desk',mode:'personal'});
  for(const name of ['Hearthline','Qwen'])await command('model.save',{name,model:name.toLowerCase(),baseUrl:`http://127.0.0.1:${fake.address().port}/v1`,runtime:'compatible',thinking:false});
  const chatId=app.store.state.chats[0].id;
  await command('table.roster.start',{chatId});
  for(let n=0;n<2;n++){const chat=app.store.state.chats[0];await command('table.roster.chair',{chatId,baseRevisionId:chat.seating.revisionId,chairId:n===0?chat.seating.desk.id:null,name:n===0?'Hearthline':'Qwen',modelId:app.store.state.models[n].id,personalId:null,coat:null});}
  return {app,requests,dir,chatId,command,fakeUrl:`http://127.0.0.1:${fake.address().port}/v1`,async close(){for(const q of requests)if(!q.res.writableEnded)finish(q);await app.dispose();fake.closeAllConnections();await new Promise(r=>fake.close(r));}};
}
export function finish(q,text='Test reply'){
  if(q.res.writableEnded||q.res.destroyed)return;
  q.res.writeHead(200,{'content-type':'text/event-stream'});
  q.res.end(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
}
export function callTool(q,name,args,id='call_test'){
  q.res.writeHead(200,{'content-type':'text/event-stream'});
  q.res.end(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
}
export async function until(check,explain,ms=5000){const end=Date.now()+ms;while(Date.now()<end){if(check())return;await delay(20);}assert.fail(typeof explain==='function'?explain():explain);}
export function input(f,content,id='request_test'){const chat=f.app.store.state.chats.find(c=>c.id===f.chatId);return {chatId:f.chatId,content,requestId:id,baseRevisionId:chat.seating.revisionId,lastMessageId:f.app.store.state.messages.filter(m=>m.chatId===f.chatId).at(-1)?.id??null,speaker:'personal',replyMode:'single',toolsEnabled:false};}
