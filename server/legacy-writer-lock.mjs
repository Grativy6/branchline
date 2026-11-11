import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// A lifetime file-handle check retires old PID-only metadata without guessing
// from a reused PID. Current writers use the cross-platform SQLite guard.
export async function recoverUnheldLegacyLock(file,prior){
  if(process.platform!=='win32')return null;
  const root=path.dirname(path.resolve(file)),folder=path.join(root,'journal-recovery','recovery-'+crypto.randomUUID()),saved=path.join(folder,'writer-lock.json');
  await fs.mkdir(folder,{recursive:true});
  const script=`$ErrorActionPreference='Stop'
$r=$env:BRANCHLINE_LOCK_RECOVERY | ConvertFrom-Json
$f=[IO.Path]::GetFullPath($r.file)
if([IO.Path]::GetFileName($f) -ne '.writer.lock' -or [IO.Path]::GetDirectoryName($f) -ne [IO.Path]::GetFullPath($r.root)){throw 'Unexpected writer-lock path'}
$stream=$null
try {
  $item=Get-Item -LiteralPath $f
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked writer metadata'}
  $stream=[IO.FileStream]::new($f,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Delete)
  if($stream.Length -gt 16384){throw 'Oversized writer metadata'}
  $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$true,1024,$true)
  $raw=$reader.ReadToEnd();$reader.Dispose();$owner=$raw | ConvertFrom-Json
  if($owner.token -cne $r.token){throw 'Writer metadata changed'}
  $destination=[IO.Path]::GetFullPath($r.saved)
  if(-not $destination.StartsWith([IO.Path]::GetFullPath($r.root)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Recovery path escaped the workspace'}
  $copy=[IO.FileStream]::new($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$stream.Position=0;$stream.CopyTo($copy);$copy.Flush($true)}finally{$copy.Dispose()}
  [IO.File]::Delete($f)
  'LOCK_RELEASED'
} catch { 'LOCK_HELD' } finally { if($stream){$stream.Dispose()} }
`;
  const released=await new Promise(resolve=>{
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BRANCHLINE_LOCK_RECOVERY:JSON.stringify({file,root,saved,token:prior.token})}});
    let output='';const timer=setTimeout(()=>child.kill(),8000);timer.unref();
    child.stdout.on('data',b=>output+=b);child.stderr.resume();
    child.once('error',()=>{clearTimeout(timer);resolve(false);});child.once('close',()=>{clearTimeout(timer);resolve(output.includes('LOCK_RELEASED'));});
  });
  return released?{file:saved,priorPid:prior.pid}:null;
}
