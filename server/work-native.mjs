import {spawn} from 'node:child_process';
import readline from 'node:readline';
export const workEnvironment=()=>Object.fromEntries(['SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','PATH','PATHEXT','APPDATA','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
export class WorkNative {
 constructor(executable=process.env.BRANCHLINE_NATIVE_FILES??null){this.executable=executable;}
 available(){return process.platform==='win32'&&!!this.executable;}
 async call(request,{signal,beforeCommit=async()=>{},onProgress=()=>{},timeoutMs=15000}={}){
  if(!this.available())throw new Error('These window and approved-program tools need the Windows desktop build.');signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const child=spawn(this.executable,['--work-host'],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,env:workEnvironment()});
   let result=null,problem=null,bytes=0,chain=Promise.resolve(),committed=false,partial={stdout:'',stderr:''};
   const abort=()=>{problem=new Error(committed?'Work stopped after execution began; inspect its result before repeating it.':'Work stopped before execution.');child.kill();};signal?.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>{problem=new Error(committed?'Work exceeded its time bound; inspect any retained output before repeating it.':'The work helper timed out.');child.kill();},timeoutMs);
   child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
   const lines=readline.createInterface({input:child.stdout});
   lines.on('line',line=>{chain=chain.then(async()=>{bytes+=Buffer.byteLength(line);if(bytes>24*1024*1024)throw new Error('Work helper output exceeded its bound.');const value=JSON.parse(line);
    if(value.progress){if(!['stdout','stderr'].includes(value.stream)||typeof value.text!=='string')throw new Error('Invalid progress data.');partial[value.stream]+=value.text;if(partial.stdout.length>64000||partial.stderr.length>16000)throw new Error('Progress output exceeded its bound.');onProgress({stdoutCharacters:partial.stdout.length,stderrCharacters:partial.stderr.length});}
    else if(value.prepared){if(committed)throw new Error('Repeated execution handshake.');signal?.throwIfAborted();await beforeCommit(value.detail);signal?.throwIfAborted();committed=true;child.stdin.end('RUN\n');}
    else{if(result)throw new Error('Repeated helper result.');result=value;}
   }).catch(error=>{problem=error;child.kill();});});
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);lines.close();};
   child.on('error',error=>{cleanup();reject(error);});
   child.on('close',()=>{void chain.then(()=>{cleanup();if(problem){const safe=t=>(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}/.test(t)||process.env.OPENAI_API_KEY&&t.includes(process.env.OPENAI_API_KEY))?'[Output withheld: credential-like value.]':t;problem.partial={completed:false,uncertain:committed,stdout:safe(partial.stdout),stderr:safe(partial.stderr)};reject(problem);}else if(!result)reject(new Error(committed?'The work ended without a confirmed result; inspect the target before retrying.':'The work helper returned no result.'));else if(!result.ok)reject(new Error(result.error));else resolve(result.value);});});
   child.stdin.write(JSON.stringify(request)+'\n');
  });
 }
}
