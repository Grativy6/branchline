// Real pinned helper processes, synthetic personal context and an immediate model.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fixture,input,until} from '../tests/desk-helpers.mjs';
import {PersonalContexts} from '../server/personal-context-manager.mjs';
import {PersonalContextBridge} from '../server/personal-context-bridge.mjs';
const [manifest,output]=process.argv.slice(2);if(!manifest||!output)throw new Error('Supply the pinned runtime manifest and output file.');
const original=PersonalContextBridge.prototype.call,observations=[];
PersonalContextBridge.prototype.call=async function(...args){const start=performance.now();try{return await original.apply(this,args);}finally{observations.push({tool:args[1],ms:Math.round(performance.now()-start)});}};
const f=await fixture({hold:false,modelOptions:{personalContextOptions:{manifest}}});
try{
  const contexts=new PersonalContexts(f.app.store,{manifest});
  const content={name:'Synthetic timing profile',orientation:'Synthetic guidance.',account:'Original synthetic account.',sources:Array.from({length:4},(_,i)=>({title:'Reference '+i,origin:'synthetic',kind:'reference',text:'Synthetic reference '+i+'. '.repeat(30)}))};
  const created=await contexts.create({operation:'timing_create',content,bundle:null}),detail=await contexts.inspect(created.profile);
  await contexts.bind({chatId:f.chatId,profileId:created.profile,seats:['personal'],modelIds:[f.app.store.state.models[0].id],sourceIds:detail.current.content.sources.map(s=>s.id)});
  const runs=[];
  for(let i=0;i<2;i++){
    if(i){const d=await contexts.inspect(created.profile);await contexts.revise({profile:created.profile,operation:'timing_revise',expectedHead:d.head,baseRevision:d.current.operation,content:{...content,account:'Updated synthetic account.'}});}
    const first=observations.length,start=performance.now(),request=await f.app.deskTasks.admit(input(f,'A synthetic timing reply.','timing_'+i));
    await until(()=>f.app.deskTasks.status().find(t=>t.id===request.taskIds[0])?.status==='completed','timed reply',45000);
    runs.push({reply:i+1,ms:Math.round(performance.now()-start),helperCalls:observations.slice(first)});
  }
  assert(JSON.stringify(f.requests.at(-1).body.messages).includes('Updated synthetic account.'));
  const result={status:'PASS',method:'Ordinary chair reply with four selected sources and actual pinned continuity helpers; injected immediate model response.',runs,updatedRevisionObserved:true,fixture:f.dir};
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'PASS',replies:runs.map(r=>({ms:r.ms,helperCalls:r.helperCalls.length})),updatedRevisionObserved:true}));
}finally{PersonalContextBridge.prototype.call=original;await f.close();}
