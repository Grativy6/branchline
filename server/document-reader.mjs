import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workEnvironment} from './work-native.mjs';
import {workRecord} from './work-access.mjs';
import {digest} from './integrity.mjs';
import {resourceSettings} from '../public/resource-settings.js';
const fail=(ok,why)=>{if(!ok)throw new Error('Documents: '+why);};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const worker=fileURLToPath(new URL('../tools/document-reader.py',import.meta.url));
export class DocumentReader {
 constructor(store,objects,{runtimeFile=fileURLToPath(new URL('../.local/home-runtime.json',import.meta.url)),python=null}={}){this.store=store;this.objects=objects;this.runtimeFile=runtimeFile;this.python=python;}
 async extract(input,signal){
  fail(input&&Object.keys(input).sort().join()==='base64,chatId,name'&&typeof input.name==='string'&&input.name.length<=170&&!/[\\/:\x00-\x1f]/.test(input.name),'choose a document by its filename and bytes.');
  const chat=this.store.state.chats.find(c=>c.id===input.chatId);fail(chat,'choose an existing conversation.');
  const kind=input.name.toLowerCase().endsWith('.pdf')?'pdf':input.name.toLowerCase().endsWith('.docx')?'docx':null;fail(kind,'choose PDF or DOCX.');
  fail(typeof input.base64==='string'&&input.base64.length<=14*1024*1024,'choose a document up to 10 MiB.');const bytes=Buffer.from(input.base64,'base64');fail(bytes.length&&bytes.length<=10*1024*1024&&bytes.toString('base64')===input.base64,'invalid selected bytes.');
  let python=this.python;if(!python){const runtime=JSON.parse(await fs.readFile(this.runtimeFile,'utf8'));python=runtime.python;fail(sha(await fs.readFile(python))===runtime.pythonSha256,'the selected reader runtime changed.');}
  signal?.throwIfAborted();
  const result=await new Promise((resolve,reject)=>{const child=spawn(python,['-I',worker],{shell:false,windowsHide:true,env:workEnvironment(),stdio:['pipe','pipe','pipe']});let chunks=[],size=0,problem;const abort=()=>{problem=new Error('Document reading stopped.');child.kill();};signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{problem=new Error('Document reading exceeded 20 seconds.');child.kill();},20000);child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});child.stdout.on('data',c=>{size+=c.length;if(size>8*1024*1024){problem=new Error('Extracted output exceeded its bound.');child.kill();}else chunks.push(c);});child.on('error',e=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(e);});child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(problem)return reject(problem);try{const v=JSON.parse(Buffer.concat(chunks));fail(code===0&&!v.error,v.error??'the reader stopped without a result.');resolve(v);}catch(e){reject(e);}});child.stdin.end(JSON.stringify({kind,base64:input.base64}));});
  signal?.throwIfAborted();const original=await this.objects.put(bytes,kind,{});
  const limit=resourceSettings(this.store.state.roots.find(r=>r.id===chat.rootId)).fileBytes;
  let text=`[Extracted document: ${input.name}; original SHA-256 ${original.sha256}]\n${JSON.stringify(result.source)}\n${result.text}`;
  const encoded=Buffer.from(text);const truncated=result.truncated||encoded.length>limit-250;if(truncated){text=new TextDecoder('utf-8').decode(encoded.subarray(0,limit-250));text+='\n[Extraction ended at its configured limit. The original remains available in Outputs; this is not a complete document reading.]';}
  let artifact;await this.store.transact(s=>{signal?.throwIfAborted();artifact=workRecord(s,'artifacts',{chatId:input.chatId,taskId:'document_'+crypto.randomUUID(),kind:'selected_document',text,textHash:digest(text),document:{name:input.name,original,extraction:result.source,truncated}});return s;});
  return {artifactId:artifact.id,name:input.name+'.txt',base64:Buffer.from(text).toString('base64'),size:Buffer.byteLength(text),source:result.source,truncated};
 }
}
