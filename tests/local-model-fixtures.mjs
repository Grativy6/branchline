import fs from 'node:fs/promises';
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const str=s=>{const b=Buffer.from(s);return Buffer.concat([u64(b.length),b]);};
export async function writeGguf(file,{name='Fixture base model',architecture='llama',template=null,description='A synthetic model file for library checks.',seed=1}={}){
  const entries=[['general.architecture',8,str(architecture)],['general.name',8,str(name)],['general.description',8,str(description)],[architecture+'.context_length',4,u32(8192)],['general.file_type',4,u32(15)]];
  if(template!==null)entries.push(['tokenizer.chat_template',8,str(template)]);
  const bytes=Buffer.concat([Buffer.from('GGUF'),u32(3),u64(1),u64(entries.length),...entries.flatMap(([key,type,value])=>[str(key),u32(type),value]),Buffer.alloc(64,seed)]);
  await fs.writeFile(file,bytes);return bytes;
}
