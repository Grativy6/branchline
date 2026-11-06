import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readRuntime} from './runtime-paths.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const MODEL_TOOLS=['read_personal_context','find_personal_source','read_personal_source','propose_personal_note'];
const HOST_TOOLS=[...MODEL_TOOLS,'inspect_personal_context','change_personal_context','export_personal_context'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export class PersonalContextBridge{
  constructor({dataDir,workspaceId,manifest=null}){this.dataDir=dataDir;this.workspaceId=workspaceId;this.manifest=manifest;this.launches=0;}
  async available(){return readRuntime('personal-context-runtime.json',this.manifest).then(()=>true,()=>false);}
  async call({profile,mode,author,revision=null,guard},name,args={}){
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(profile)||!['host','model'].includes(mode)||typeof guard!=='function'||!(mode==='host'?['local_ui','automatic_policy','external_file']:['model']).includes(author?.kind)||!(mode==='host'?HOST_TOOLS:MODEL_TOOLS).includes(name))throw new Error('Personal continuity capability is invalid.');
    guard(); // Admission happens before even opening the runtime/starting MCP discovery.
    const runtime=await readRuntime('personal-context-runtime.json',this.manifest);
    if(runtime.format!=='branchline.personal-context-runtime/1'||!path.isAbsolute(runtime.python)||!path.isAbsolute(runtime.packageRoot)||!Array.isArray(runtime.files))throw new Error('Personal continuity runtime needs setup.');
    if(hash(await fs.readFile(runtime.python))!==runtime.pythonSha256)throw new Error('The configured Python executable changed.');
    for(const file of runtime.files){
      if(!['__init__.py','store.py','personal_context.py','personal_server.py'].includes(file.name)||hash(await fs.readFile(path.join(runtime.packageRoot,'hearthline_mcp',file.name)))!==file.sha256)throw new Error('The pinned personal continuity service changed. Rebuild its runtime manifest.');
    }
    if(new Set(runtime.files.map(file=>file.name)).size!==4||runtime.files.length!==4)throw new Error('Incomplete runtime source lock.');
    guard();
    const config={root:path.join(this.dataDir,'personal-context-store'),user:this.workspaceId,profile,mode,author,revision};
    const transport=new StdioClientTransport({command:runtime.python,args:['-I','-B','-c',"import sys,runpy;sys.path.insert(0,sys.argv[1]);runpy.run_module('hearthline_mcp.personal_server',run_name='__main__')",runtime.packageRoot],cwd:path.dirname(runtime.python),
      env:{HEARTHLINE_PERSONAL_CONTEXT_CONFIG:JSON.stringify(config),HEARTHLINE_PERSONAL_CONTEXT_LIFETIME:'45',PYTHONUTF8:'1'},stderr:'pipe'});
    const client=new Client({name:'branchline-personal-context',version:'0.1.0'});this.launches++;
    let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{transport.close().catch(()=>{});reject(new Error('Personal continuity request exceeded 20 seconds. Inspect its operation before retrying a write.'));},20000);});
    try{
      const result=await Promise.race([deadline,(async()=>{
        const connecting=client.connect(transport);transport.stderr?.resume();await connecting;guard();
        const response=await client.callTool({name,arguments:args});
        if(response.isError)throw new Error((response.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').slice(0,2000));
        const value=response.structuredContent??JSON.parse(response.content.find(x=>x.type==='text').text);
        if(Buffer.byteLength(JSON.stringify(value))>220000)throw new Error('Continuity result is too large.');
        return value;
      })()]);
      return result;
    }finally{clearTimeout(timer);await client.close().catch(()=>{});await transport.close().catch(()=>{});}
  }
}
