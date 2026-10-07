// Pinned real runtime, synthetic local provider; no login, account, or OpenAI calls.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CodexRpc } from '../server/codex-rpc.mjs';
import { verifiedCodexBinary,codexEnvironment } from '../server/codex-provider.mjs';
import { codexArgs,codexThreadParams,CODEX_SHA256 } from '../server/codex-policy.mjs';
import { withToolImage,codexToolContent } from '../server/tool-images.mjs';
const base=process.argv[2]||path.resolve('test-results/tool-image-'+Date.now());await fs.mkdir(base,{recursive:true});
const home=path.join(base,'home'),cwd=path.join(base,'empty');await fs.mkdir(home);await fs.mkdir(cwd);
const bytes=await sharp({create:{width:96,height:64,channels:3,background:'#5b9054'}}).png().toBuffer();
const result=await withToolImage({ok:true,value:{frameId:'synthetic-frame',sourceRole:'synthetic_image_evidence'}},bytes);
const content=codexToolContent(result);assert.equal(content[1].type,'inputImage');assert.equal(codexToolContent(structuredClone(result)).length,1);
const cancelled=new AbortController();cancelled.abort();assert.throws(()=>codexToolContent(result,cancelled.signal));
const requests=[];let rpc;
const server=http.createServer(async(req,res)=>{let input='';for await(const b of req)input+=b;if(!input){res.writeHead(404);res.end();return;}
  const body=JSON.parse(input);requests.push(body);const item=requests.length===1?{type:'function_call',id:'frame-call',call_id:'frame-call',name:'inspect_test_frame',arguments:'{}'}:{type:'message',id:'answer',role:'assistant',content:[{type:'output_text',text:'Synthetic image received.'}]};
  res.writeHead(200,{'content-type':'text/event-stream','connection':'close'});
  for(const [type,data] of [['response.created',{response:{id:'r'+requests.length}}],['response.output_item.done',{output_index:0,item}],['response.completed',{response:{id:'r'+requests.length,output:[item],usage:{input_tokens:10,output_tokens:4,total_tokens:14}}}]])res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);res.end();
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  rpc=new CodexRpc(await verifiedCodexBinary(),[...codexArgs(),'-c','model_provider="fixture"','-c',`model_providers.fixture={name="Fixture",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`],{cwd,env:codexEnvironment(home,cwd)});
  await rpc.request('initialize',{clientInfo:{name:'branchline_image_probe',version:'1'},capabilities:{experimentalApi:true}});rpc.notify('initialized');
  const params=codexThreadParams({model:'gpt-6-astra'},[{role:'system',content:'Synthetic fixture.'},{role:'user',content:'Inspect the synthetic frame.'}],cwd,null,[{name:'inspect_test_frame',description:'Return a synthetic test image.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}]);
  const thread=await rpc.request('thread/start',{...params,modelProvider:'fixture'});
  rpc.toolHandler=async p=>{assert.equal(p.threadId,thread.thread.id);assert.equal(p.tool,'inspect_test_frame');return {contentItems:content,success:true};};
  let timer;const done=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Image probe timed out')),45000);rpc.on('notification',e=>{if(e.method==='turn/completed'&&e.params.threadId===thread.thread.id){clearTimeout(timer);resolve(e.params);}});});
  await rpc.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Inspect the synthetic frame.'}],environments:[],runtimeWorkspaceRoots:[],approvalPolicy:'never',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'},summary:'none'});
  const completed=await done;assert.equal(completed.turn.status,'completed',JSON.stringify(completed.turn.error));
  assert.equal(requests.length,2);const returned=JSON.stringify(requests[1].input);assert(returned.includes('input_image')&&returned.includes(bytes.toString('base64')),'Pixel content did not reach the provider as an image.');
  const report={status:'PASS',kind:'REAL_PINNED_CODEX_SYNTHETIC_PROVIDER',executableSha256:CODEX_SHA256,providerRequests:requests.length,realModelRequests:0,checks:['dynamic tool image callback','image pixels reach next provider request as image content','unbranded JSON cannot attach pixels','cancelled image delivery refused'],limit:'No screen capture or live vision-model behavior is established.'};
  await fs.writeFile(path.join(base,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{rpc?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
