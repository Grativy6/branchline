import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_HEADER = 32 * 1024 * 1024;
const widths = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8};
const wanted = key => /^general\.(name|architecture|description|file_type|type|size_label|finetune)$/.test(key)
  || /\.context_length$/.test(key) || key === 'tokenizer.chat_template' || key === 'split.count';
const decode = new TextDecoder('utf-8',{fatal:true});

// Read the metadata prefix, never allocate according to values supplied by a file.
// Token tables and other unneeded metadata are skipped in the bounded buffer.
export function ggufMetadata(buffer, fileBytes = buffer.length) {
  let at=0;
  const take=n=>{if(!Number.isSafeInteger(n)||n<0||at+n>buffer.length)throw new Error('GGUF metadata is incomplete or larger than the supported header size.');const b=buffer.subarray(at,at+n);at+=n;return b;};
  const u32=()=>take(4).readUInt32LE();
  const u64=()=>{const n=take(8).readBigUInt64LE();if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('GGUF metadata count is too large.');return Number(n);};
  const string=keep=>{const n=u64();const bytes=take(n);return keep?decode.decode(bytes):null;};
  function value(type,keep){
    if(type===8)return string(keep);
    if(type===9){const kind=u32(),n=u64();if(n>1000000||kind===9)throw new Error('Unsupported GGUF metadata array.');if(widths[kind])take(n*widths[kind]);else if(kind===8)for(let i=0;i<n;i++)string(false);else throw new Error('Unknown GGUF metadata type.');return null;}
    const width=widths[type];if(!width)throw new Error('Unknown GGUF metadata type.');const b=take(width);if(!keep)return null;
    return ({0:()=>b.readUInt8(),1:()=>b.readInt8(),2:()=>b.readUInt16LE(),3:()=>b.readInt16LE(),4:()=>b.readUInt32LE(),5:()=>b.readInt32LE(),6:()=>b.readFloatLE(),7:()=>b[0]!==0,10:()=>Number(b.readBigUInt64LE()),11:()=>Number(b.readBigInt64LE()),12:()=>b.readDoubleLE()})[type]();
  }
  if(take(4).toString()!=='GGUF')throw new Error('This file is not a GGUF model.');
  const version=u32();if(![2,3].includes(version))throw new Error('This GGUF version is not supported.');
  const tensors=u64(),count=u64();if(count>10000||tensors>1000000)throw new Error('GGUF metadata count is too large.');
  const fields={};for(let i=0;i<count;i++){const key=string(true);if(key.length>1024)throw new Error('Invalid GGUF metadata key.');const v=value(u32(),wanted(key));if(wanted(key))fields[key]=v;}
  if(!tensors||at>=fileBytes)throw new Error('This GGUF has no complete model payload.');
  const architecture=fields['general.architecture'];if(typeof architecture!=='string'||architecture.length>100)throw new Error('This GGUF does not identify its architecture.');
  const context=fields[architecture+'.context_length'];
  const auxiliary=fields['general.type']==='adapter'||['clip','mtmd','nomic-bert','bert'].includes(architecture);
  return {version,tensors,architecture,name:typeof fields['general.name']==='string'?fields['general.name'].slice(0,200):null,
    description:typeof fields['general.description']==='string'?fields['general.description'].slice(0,4000):'',
    sizeLabel:typeof fields['general.size_label']==='string'?fields['general.size_label'].slice(0,80):null,
    fileType:Number.isSafeInteger(fields['general.file_type'])?fields['general.file_type']:null,
    contextLength:Number.isSafeInteger(context)&&context>=512&&context<=10000000?context:null,
    inputFormat:typeof fields['tokenizer.chat_template']==='string'&&fields['tokenizer.chat_template'].trim()?'chat':'plain-dialogue-v1',
    unsupportedReason:auxiliary?'This is a supporting or embedding model, not a standalone conversation model.':Number(fields['split.count'])>1?'Split GGUF models are not supported by this loader yet.':null};
}
export async function inspectGguf(file) {
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Choose a regular local GGUF file.');
  const handle=await fs.open(file,'r');
  try{
    const size=Math.min(MAX_HEADER,stat.size),buffer=Buffer.alloc(size);let read=0;
    while(read<size){const r=await handle.read(buffer,read,size-read,read);if(!r.bytesRead)break;read+=r.bytesRead;}
    const metadata=ggufMetadata(buffer.subarray(0,read),stat.size);
    metadata.descriptionSource=metadata.description?'GGUF metadata':null;
    if(!metadata.description)for(const name of [path.basename(file).replace(/\.gguf$/i,'.md'),'model-card.md','README.md']){
      const note=path.join(path.dirname(file),name),info=await fs.lstat(note).catch(()=>null);
      if(!info?.isFile()||info.isSymbolicLink()||info.size>65536)continue;
      try{const text=decode.decode(await fs.readFile(note)).replace(/^---\r?\n[\s\S]*?\r?\n---\s*/,''),paragraph=text.split(/\r?\n\s*\r?\n/).find(p=>p.trim()&&!/^(#|!\[|```|\|)/.test(p.trim()));if(paragraph){metadata.description=paragraph.trim().slice(0,2000);metadata.descriptionSource=name;break;}}catch{ /* A missing/unreadable note does not invalidate the model file. */ }
    }
    if(/(?:^|[.\-_])(mmproj|mtp)(?:[.\-_]|$)/i.test(path.basename(file)))metadata.unsupportedReason='This is a supporting model file; choose its language model instead.';
    if(/-\d{5}-of-\d{5}\.gguf$/i.test(file))metadata.unsupportedReason='Split GGUF models are not supported by this loader yet.';
    return {path:await fs.realpath(file),bytes:stat.size,mtimeMs:stat.mtimeMs,...metadata};
  }finally{await handle.close();}
}
