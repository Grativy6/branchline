import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const HOME_TOOLS = Object.freeze(['come_home','find_context','read_source','shelf_status']);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (ok, why) => { if (!ok) throw new Error('Home: ' + why); };
const requiredFiles=['hearthline_cabin/__init__.py','hearthline_cabin/reader.py','hearthline_cabin/shelf_server.py'];
const launcher=fileURLToPath(new URL('../tools/home-reader.py',import.meta.url));

// A fixed, reviewed reader; a saved binding never supplies an executable or tool.
// The reader enforces source roots and read-only behavior. This is not a general
// MCP process launcher and does not assert OS isolation of arbitrary adapters.
export class HomeReader {
  constructor({runtime,configPath,configSha256=null,timeoutMs=20000}) { this.configSha256=configSha256;this.runtime=runtime;this.configPath=configPath;this.timeoutMs=timeoutMs;this.client=null;this.transport=null;this.signature=null;this.connecting=null; }
  async verify() {
    const r=this.runtime;
    fail(r?.format==='branchline.home-runtime/1' && typeof r.python==='string' && typeof r.packageRoot==='string' && Array.isArray(r.files), 'the read profile runtime is not configured.');
    fail(r.files.length===requiredFiles.length && requiredFiles.every(name=>r.files.some(f=>f.path===name)), 'the runtime must pin only the supported reader package.');
    fail(sha(await fs.readFile(r.python))===r.pythonSha256,'the selected Python runtime changed.');
    for(const item of r.files)fail(sha(await fs.readFile(path.join(r.packageRoot,item.path)))===item.sha256,'the reader package changed; review its source before reconnecting.');
    const bytes=await fs.readFile(this.configPath);fail(bytes.length<=32768,'the source configuration is too large.');
    this.configSha256??=sha(bytes);fail(sha(bytes)===this.configSha256,'the source configuration changed outside its selected grant.');
    return sha(Buffer.concat([Buffer.from(JSON.stringify(r)),bytes]));
  }
  async connect() {
    if(this.connecting)return this.connecting;
    this.connecting=this.open();
    try{return await this.connecting;}finally{this.connecting=null;}
  }
  async open() {
    const signature=await this.verify();
    if(this.client && signature===this.signature)return this.client;
    await this.close();
    const env=Object.fromEntries(['SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','PATH','PATHEXT'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    env.HEARTHLINE_CABIN_READ_CONFIG=this.configPath;
    const transport=new StdioClientTransport({command:this.runtime.python,args:['-I','-B',launcher,this.runtime.packageRoot],env,stderr:'pipe'});
    const client=new Client({name:'Branchline Home',version:'0.8.16-preview.1'},{capabilities:{}});
    this.transport=transport;
    try {
      await client.connect(transport,{timeout:this.timeoutMs});
      transport.stderr?.on('data',()=>{});
      const {tools}=await client.listTools(undefined,{timeout:this.timeoutMs});
      fail(tools.length===HOME_TOOLS.length && HOME_TOOLS.every(name=>tools.some(t=>t.name===name&&t.annotations?.readOnlyHint===true)), 'the server exposed an unexpected tool surface.');
      this.client=client;this.signature=signature;return client;
    } catch(error) { await transport.close().catch(()=>{});this.transport=null;throw error; }
  }
  async call(name,args={},signal) {
    fail(HOME_TOOLS.includes(name),'only the fixed read tools are available.');signal?.throwIfAborted();
    const client=await this.connect();signal?.throwIfAborted();
    try {
      const result=await client.callTool({name,arguments:args},undefined,{timeout:this.timeoutMs,signal});
      const encoded=JSON.stringify(result);fail(Buffer.byteLength(encoded)<=512*1024,'the reader result exceeded its bound.');
      fail(!result.isError,'the requested passage could not be read: '+(result.content?.find(c=>c.type==='text')?.text??'unavailable').slice(0,1000));
      const value=result.structuredContent ?? JSON.parse(result.content.find(c=>c.type==='text').text);
      return { ...value, transport:'MCP stdio', profile:'hearthline.shelf-read/1' };
    } catch(error) { if(signal?.aborted)await this.close();throw error; }
  }
  async close() { const client=this.client,transport=this.transport;this.client=null;this.transport=null;this.signature=null;await client?.close().catch(()=>{});if(!client)await transport?.close().catch(()=>{}); }
}
