import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { JOURNAL_MAGIC, FRAME_HEADER_BYTES } from './journal-codec.mjs';
import { replayJournal } from './journal.mjs';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = message => { throw new Error('Journal recovery: ' + message); };
const idPattern = /^recovery-[a-f0-9-]{36}$/;
export const validRecoveryFile = n => /^journal-recovery\/recovery-[a-f0-9-]{36}\/(original\.journal|replacement\.journal|recovery\.json|completed\.json|writer-lock\.json)$/.test(n);
async function fingerprint(file) {
  const h=crypto.createHash('sha256');let size=0;
  for await(const b of createReadStream(file)){h.update(b);size+=b.length;}
  return {size,sha256:h.digest('hex')};
}
async function exact(handle,size,position){const b=Buffer.alloc(size);let n=0;while(n<size){const r=await handle.read(b,n,size-n,position+n);if(!r.bytesRead)fail('journal changed while reading.');n+=r.bytesRead;}return b;}
async function writeJson(file,value){const h=await fs.open(file,'wx',0o600);try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}}
async function copyPrefix(source,destination,size,newline=false){
  const h=await fs.open(destination,'wx',0o600);
  try{if(size)for await(const b of createReadStream(source,{start:0,end:size-1}))await h.writeFile(b);if(newline)await h.writeFile('\n');await h.sync();}finally{await h.close();}
}
async function candidate(file){
  const h=await fs.open(file,'r').catch(e=>e.code==='ENOENT'?null:Promise.reject(e));if(!h)return null;
  try{
    const stat=await h.stat();if(!stat.size)return null;
    const magic=await exact(h,Math.min(stat.size,JOURNAL_MAGIC.length),0);
    if(magic.equals(JOURNAL_MAGIC)){
      let at=JOURNAL_MAGIC.length;
      while(at<stat.size){
        const left=stat.size-at;if(left<FRAME_HEADER_BYTES)return at>JOURNAL_MAGIC.length?{keep:at,mode:'incomplete-packed-tail'}:null;
        const head=await exact(h,FRAME_HEADER_BYTES,at),raw=Number(head.readBigUInt64LE(0)),stored=Number(head.readBigUInt64LE(8));
        if(!Number.isSafeInteger(raw)||raw<=0||!Number.isSafeInteger(stored)||stored<=0) return null;
        if(stored>left-FRAME_HEADER_BYTES){
          // A complete body with a damaged length field is corruption, not a
          // shortened append. Leave it intact for explicit recovery.
          const available=left-FRAME_HEADER_BYTES;
          if(available<=16*1024*1024){
            const body=await exact(h,available,at+FRAME_HEADER_BYTES);
            if(sha(body)===head.subarray(48,80).toString('hex'))return null;
            try{const decoded=brotliDecompressSync(body,{maxOutputLength:Math.min(raw+1,64*1024*1024)});if(decoded.length===raw&&sha(decoded)===head.subarray(16,48).toString('hex'))return null;}catch{}
          }
          return at>JOURNAL_MAGIC.length?{keep:at,mode:'incomplete-packed-tail'}:null;
        }
        at+=FRAME_HEADER_BYTES+stored;
      }
      return null;
    }
    if((await exact(h,1,stat.size-1))[0]===10)return null;
    let keep=null;
    for(let end=stat.size;end>0&&keep===null;){const start=Math.max(0,end-65536),block=await exact(h,end-start,start),i=block.lastIndexOf(10);if(i>=0)keep=start+i+1;end=start;}
    if(keep===null)return null;
    // Only an unfinished JSON ending qualifies. Other malformed final records
    // stay untouched. A complete JSON record missing just LF can be preserved.
    const length=stat.size-keep;if(length>64*1024*1024)return null;
    const last=(await exact(h,length,keep)).toString('utf8');
    try{JSON.parse(last);return {keep:stat.size,newline:true,mode:'missing-final-delimiter'};}
    catch(e){if(!/end of JSON input|Unterminated string/i.test(e.message))return null;}
    return {keep,mode:'incomplete-plain-tail'};
  }finally{await h.close();}
}

async function finish(file,folder,plan,{beforePublish=()=>{},afterPublish=()=>{}}={}){
  const original=path.join(folder,'original.journal'),replacement=path.join(folder,'replacement.journal');
  const current=await fingerprint(file),recorded=await fingerprint(original);
  if(recorded.sha256!==plan.original.sha256||recorded.size!==plan.original.size)fail('preserved recovery bytes changed: '+folder);
  if(current.sha256!==plan.replacement.sha256||current.size!==plan.replacement.size){
    if(current.sha256!==plan.original.sha256||current.size!==plan.original.size)fail('the journal changed since recovery was prepared: '+folder);
    const staged=await fingerprint(replacement);
    if(staged.sha256!==plan.replacement.sha256||staged.size!==plan.replacement.size)fail('prepared recovery bytes changed: '+folder);
    await replayJournal(replacement);
    await beforePublish();
    await fs.rename(replacement,file);
    await afterPublish();
  }
  const done={...plan,completedAt:new Date().toISOString(),directory:folder};
  await writeJson(path.join(folder,'completed.json'),done);return done;
}

// Called only with the Store's exclusive writer guard held. Publishing replaces
// the file atomically; a prepared record survives a crash on either side.
export async function recoverJournalTail(file,options={}){
  const root=path.join(path.dirname(file),'journal-recovery');let result=null;
  const folders=await fs.readdir(root,{withFileTypes:true}).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));
  for(const entry of folders.filter(e=>e.isDirectory()&&idPattern.test(e.name))){
    const folder=path.join(root,entry.name);
    if(await fs.stat(path.join(folder,'completed.json')).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)))continue;
    const plan=await fs.readFile(path.join(folder,'recovery.json'),'utf8').then(JSON.parse,e=>e.code==='ENOENT'?null:Promise.reject(e));
    if(plan){if(plan.profile!=='branchline.journal-recovery/1')fail('unknown prepared recovery: '+folder);result=await finish(file,folder,plan,options);}
  }
  const choice=await candidate(file);if(!choice)return result;
  const before=await fingerprint(file),folder=path.join(root,'recovery-'+crypto.randomUUID());
  await fs.mkdir(folder,{recursive:true});
  await copyPrefix(file,path.join(folder,'original.journal'),before.size);
  const original=await fingerprint(path.join(folder,'original.journal'));
  if(original.sha256!==before.sha256||original.size!==before.size)fail('journal changed before recovery.');
  await copyPrefix(path.join(folder,'original.journal'),path.join(folder,'replacement.journal'),choice.keep,choice.newline);
  const replay=await replayJournal(path.join(folder,'replacement.journal'));if(!replay.recordCount)fail('no complete history precedes this tail.');
  const replacement=await fingerprint(path.join(folder,'replacement.journal'));
  const plan={profile:'branchline.journal-recovery/1',at:new Date().toISOString(),mode:choice.mode,original,replacement,keptBytes:choice.keep,preservedTailBytes:before.size-choice.keep,recordCount:replay.recordCount};
  await writeJson(path.join(folder,'recovery.json'),plan);
  return finish(file,folder,plan,options);
}

export async function recoveryFiles(dataDir){
  const root=path.join(dataDir,'journal-recovery'),out=[];
  const folders=await fs.readdir(root,{withFileTypes:true}).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));
  for(const d of folders.filter(d=>d.isDirectory()&&idPattern.test(d.name)))for(const name of ['original.journal','replacement.journal','recovery.json','completed.json','writer-lock.json']){
    const ref=`journal-recovery/${d.name}/${name}`;
    const stat=await fs.lstat(path.join(dataDir,ref)).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));if(stat?.isSymbolicLink())fail('linked recovery file.');if(stat?.isFile())out.push(ref);
  }
  return out.sort();
}
