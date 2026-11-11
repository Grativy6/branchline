import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {LOCAL_MODEL_INSTRUCTION} from '../server/episode-prompts.mjs';
const [root,bundled,control,runtime]=process.argv.slice(2);
const app=await createApp({dataDir:path.join(root,'workspace'),bundledDir:bundled,modelOptions:{codex:{close(){},async status(){return {connected:false,models:[]};}},dreamOptions:{runtimeFile:runtime}}});
try{
  const r=app.store.state.dreamTraining.runs.findLast(r=>r.status==='ready');assert(r);
  await app.localModels.startSearch({folder:control});while(!['complete','failed','cancelled'].includes(app.localModels.searchView().phase))await new Promise(resolve=>setTimeout(resolve,100));
  const found=app.localModels.searchView(),candidate=found.candidates.find(c=>c.path===path.join(control,'candidate.gguf'));assert(candidate,'untrained control file found');
  const added=await app.localModels.add({searchId:found.id,candidateId:candidate.candidateId,name:'Untrained export control'},new AbortController().signal);
  const models=[r.targetModel,app.store.state.models.find(m=>m.id===added.modelId),app.store.state.models.find(m=>m.id===r.candidate.modelId)];
  const names=['Included stock model','Untrained export control','Trained candidate'],answers=[];
  const prompts=['I am thinking about a small garden, but I have not decided what to make. Can we discuss it?','I am considering a reading corner. Please help me explore before making a plan.'];
  for(let i=0;i<models.length;i++)for(const prompt of prompts){
    const model=models[i],body={model:model.model,messages:[{role:'system',content:LOCAL_MODEL_INSTRUCTION},{role:'user',content:prompt}],temperature:0,top_p:1,top_k:1,seed:20261110,max_tokens:160,stream:false,chat_template_kwargs:{enable_thinking:false}};
    const response=await app.localRunner.fetch(model,new URL('/v1/chat/completions',model.baseUrl),{method:'POST',signal:AbortSignal.timeout(180000),body:JSON.stringify(body)});
    assert(response.ok,'local comparison response');const value=await response.json(),text=value.choices?.[0]?.message?.content;assert(text?.trim());
    answers.push({model:names[i],prompt,text,finishReason:value.choices[0].finish_reason,usage:value.usage});
  }
  const record={status:'PASS',runId:r.id,method:'Same literal messages and deterministic decoding, including an untrained control through the same merge-free export/quantization pipeline.',decoding:{temperature:0,seed:20261110,maxTokens:160},control:JSON.parse(await fs.readFile(path.join(control,'control.json'),'utf8')),answers,conclusion:'This small functional comparison does not establish general conversational improvement.'};
  await fs.writeFile(path.join(root,'controlled-comparison.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({status:'PASS',answers:answers.length,nonzeroAdapterBTensors:record.control.nonzeroAdapterBTensors}));
}finally{await app.dispose();}
