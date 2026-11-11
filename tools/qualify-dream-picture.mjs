// One synthetic image through a completed Dream's actual local runner.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
const [root,bundled]=process.argv.slice(2);
if(!root||!bundled)throw new Error('Supply the synthetic qualification directory and bundled runtime.');
const app=await createApp({dataDir:path.join(root,'workspace'),bundledDir:bundled,modelOptions:{codex:{close(){},async status(){return {connected:false,models:[]};}}}});
try{
  const run=app.store.state.dreamTraining.runs.findLast(r=>r.status==='ready'),model=app.store.state.models.find(m=>m.id===run.candidate.modelId);
  const capability=await app.localRunner.imageCapability(model);
  const bytes=await sharp({create:{width:160,height:160,channels:3,background:'#18b948'}}).png().toBuffer();
  const response=await app.localRunner.fetch(model,new URL('/v1/chat/completions',model.baseUrl),{method:'POST',signal:AbortSignal.timeout(120000),body:JSON.stringify({model:model.model,messages:[{role:'user',content:[{type:'text',text:'What is the main color of this image? Answer with just the color.'},{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}]}],max_tokens:80,stream:false,chat_template_kwargs:{enable_thinking:false}})});
  assert(response.ok);const result=await response.json(),text=result.choices[0].message.content;assert.match(text,/green/i);
  const record={status:'PASS',candidateSha256:run.candidate.sha256,capability,reply:text,fixture:'Generated solid green square'};await fs.writeFile(path.join(root,'picture-qualification.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}finally{await app.dispose();}
