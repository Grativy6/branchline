// Explicit local-stock-model check. No accounts, live workspace or paid service.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {listen} from './helpers.mjs';
import {turnOptions} from '../public/table.js';
import {POCKET_PROFILE, BUILTIN_PROVIDER} from '../public/coat-pockets.js';
const bundle=path.resolve(process.argv[2]), out=path.resolve(process.argv[3]);await fs.mkdir(out,{recursive:true});await fs.mkdir('.test-data',{recursive:true});
const data=await fs.mkdtemp(path.resolve('.test-data/coats-stock-'));
const app=await createApp({dataDir:path.join(data,'workspace'),bundledDir:bundle});
const url=await listen(app), headers={'x-branchline-session':app.sessionToken,'content-type':'application/json'};
const report={status:'RUNNING',syntheticOnly:true,workspace:data,cases:[]};
const call=async(route,body)=>{const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();assert(r.ok,JSON.stringify(value));return value;};
try {
  const initial=await call('/api/state'), chatId=initial.chats[0].id;assert.equal(initial.models[0].runtime,'bundled');
  for(const example of [
    {tool:'read_clock',prompt:'Please call the available read_clock tool and tell me the date and time that it returns. Use the tool; do not guess.'},
    {tool:'run_calculation',prompt:'Use the available run_calculation tool to calculate 17 + 25, then give the result in one sentence.'},
    {tool:null,prompt:'Give a single short sentence about keeping seed packets dry.'}
  ]) {
    const state=await call('/api/state'),chat=state.chats[0];
    await call('/api/command',{type:'harness.create',payload:{content:{name:example.tool??'Empty pockets',description:'Synthetic smoke check',instructions:'Answer the current request clearly and briefly.',pockets:{profile:POCKET_PROFILE,selected:example.tool?[{tool:example.tool,provider:BUILTIN_PROVIDER}]:[]}},use:{chatId,baseRevisionId:chat.harnessSelections?.at(-1)?.id??null,seat:'shared'}}});
    const ready=await call('/api/state'), started=performance.now();let firstToken=null,wire='',text='';
    const response=await fetch(url+'/api/exchange',{method:'POST',headers,body:JSON.stringify({chatId,content:example.prompt,stream:true,toolsEnabled:true,...turnOptions(ready,ready.chats[0],'personal')})});
    assert(response.ok,await (!response.ok?response.text():Promise.resolve('')));
    for await(const chunk of response.body) {
      wire+=Buffer.from(chunk).toString();let end;
      while((end=wire.indexOf('\n\n'))>=0) {const part=wire.slice(0,end);wire=wire.slice(end+2);const row=part.split('\n').find(l=>l.startsWith('data: '));if(!row)continue;const event=JSON.parse(row.slice(6));if(part.startsWith('event: delta')){firstToken??=performance.now()-started;text+=event.text;}if(part.startsWith('event: error'))throw new Error(event.error);}
    }
    const final=await call('/api/state'),exchange=final.exchanges.at(-1),records=final.handoffs.records.filter(r=>r.taskId===exchange.id);
    assert.equal(exchange.status,'completed');assert(text.trim());
    const tools=records.find(r=>r.kind==='ui.intent').detail.task.capability.tools;
    assert.deepEqual(tools.tools,example.tool?[example.tool]:[]);
    const toolResults=records.filter(r=>r.kind==='operation.result'&&r.detail.tool===example.tool).map(r=>r.detail.result);
    const modelTaskStatus=!example.tool||toolResults.some(r=>r.ok===true&&(example.tool!=='run_calculation'||r.value===42))?'PASS':'PARTIAL';
    const result={tool:example.tool,text,toolResults,modelTaskStatus,routingStatus:'PASS',offered:tools.tools,firstTokenMs:firstToken,elapsedMs:performance.now()-started,metrics:exchange.metrics};report.cases.push(result);console.log(JSON.stringify(result));
  }
  report.status=report.cases.every(c=>c.modelTaskStatus==='PASS')?'PASS':'PARTIAL_MODEL_RESPONSE';
  if(report.status!=='PASS')process.exitCode=2;
} catch(error) {report.status='FAIL';report.error=error.message;throw error;}
finally {await app.dispose();report.runnerStopped=app.localRunner.child===null;await fs.writeFile(path.join(out,'local-model.json'),JSON.stringify(report,null,2)+'\n');}
