// Actual stock model; synthetic local workspace only. Explicit invocation.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/index.mjs';
import {listen} from './helpers.mjs';
import {turnOptions} from '../public/table.js';
const bundle=path.resolve(process.argv[2]);
await fs.mkdir('.test-data',{recursive:true});await fs.mkdir('test-results/v081',{recursive:true});
const dir=await fs.mkdtemp(path.resolve('.test-data/bundled-real-'));
const app=await createApp({dataDir:path.join(dir,'workspace'),bundledDir:bundle});
const url=await listen(app), headers={'x-branchline-session':app.sessionToken,'content-type':'application/json'};
const report={status:'RUNNING',syntheticOnly:true,cases:[],workspace:dir};
const call=async(route,body)=>{const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();assert(r.ok,JSON.stringify(value));return value;};
const save=()=>fs.writeFile('test-results/v081/bundled-provider.json',JSON.stringify(report,null,2)+'\n');
try {
  const first=await call('/api/state');assert.equal(first.models.length,1);assert.equal(first.models[0].runtime,'bundled');
  const chatId=first.chats[0].id;assert(first.chats[0].table.assignments[0].personalId);assert.equal(first.chats[0].table.assignments[0].visitorModelId,null);
  async function stream(content,extra={}) {
    const start=performance.now();let firstToken=null,wire='',text='',statuses=[];
    const before=await call('/api/state');
    const turn=turnOptions(before,before.chats.find(c=>c.id===chatId),'personal','send');
    const r=await fetch(url+'/api/exchange',{method:'POST',headers,body:JSON.stringify({chatId,content,stream:true,...turn,...extra})});
    if(!r.ok)throw new Error(await r.text());
    for await(const chunk of r.body) {
      wire+=Buffer.from(chunk).toString();
      let end;while((end=wire.indexOf('\n\n'))>=0){const part=wire.slice(0,end);wire=wire.slice(end+2);const data=part.split('\n').find(l=>l.startsWith('data: '));if(!data)continue;const event=JSON.parse(data.slice(6));
        if(part.startsWith('event: model_status'))statuses.push(event.message);
        if(part.startsWith('event: delta')){firstToken??=performance.now()-start;text+=event.text;}
        if(part.startsWith('event: error'))throw new Error(event.error);
      }
    }
    const state=await call('/api/state'),exchange=state.exchanges.at(-1);assert.equal(exchange.status,'completed');assert(text.trim());
    const result={prompt:content,text,firstTokenMs:firstToken,elapsedMs:performance.now()-start,metrics:exchange.metrics,statuses};
    report.cases.push(result);await save();console.log(JSON.stringify({prompt:content,text,firstTokenMs:firstToken,elapsedMs:result.elapsedMs}));return state;
  }
  await stream('Hello. My imaginary garden is named Lantern. Give me a three-item numbered list of things to keep tidy on a potting bench.');
  await stream('What name did I give my imaginary garden? Then explain in two sentences why keeping seed packets dry helps.');
  const tools=await stream('Please call the available read_clock tool and tell me the time returned by it. Do not guess a time.',{toolsEnabled:true});
  assert(tools.handoffs.records.some(r=>r.kind==='operation.result'&&r.detail.tool==='read_clock'),'A real clock tool result must exist.');
  const png=await sharp(Buffer.from('<svg width="480" height="240"><rect width="480" height="240" fill="white"/><circle cx="120" cy="120" r="75" fill="#df263b"/><rect x="290" y="45" width="150" height="150" fill="#2460da"/></svg>')).png().toBuffer();
  await call('/api/images/select',{chatId,image:{name:'synthetic-shapes.png',origin:'pick',base64:png.toString('base64')}});
  const plan=await call('/api/images/plan',{chatId,speaker:'personal'});assert.equal(plan.imageTokenAllowance,1024);
  await stream('Describe the two shapes and their colors from this picture in one sentence.',{imagePlanId:plan.id});
  const vision=report.cases.at(-1).text;assert.match(vision,/red/i);assert.match(vision,/blue/i);assert.match(vision,/circle/i);assert.match(vision,/square/i);
  await call('/api/images/context',{chatId,ids:[]});
  await call('/api/local-model/control',{action:'cpu'});
  await stream('Explain in two sentences why a small seedling bends toward a window.');
  assert.equal(app.localRunner.status().backend,'cpu');
  await call('/api/local-model/control',{action:'unload'});assert.equal(app.localRunner.child,null);
  report.status='PASS';
} catch(error) { report.status='FAIL';report.error=error.message;throw error; }
finally {await app.dispose();report.runnerStopped=app.localRunner.child===null;await save();}
