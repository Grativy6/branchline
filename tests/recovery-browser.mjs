import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {createApp} from '../server/index.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-recovery-ui-')),data=path.join(dir,'workspace');
const old=new Store(data,{checkpoints:false,compressionThreshold:Infinity});await old.open();await old.command({type:'root.create',payload:{name:'Recovered synthetic desk',mode:'personal'}});await old.command({type:'message.note',payload:{chatId:old.state.chats[0].id,content:'The saved note stays here.'}});await old.close();
await fs.appendFile(path.join(data,'events.jsonl'),'{"unfinished":');
const app=await createApp({dataDir:data,bundledDir:path.join(dir,'no-model'),modelOptions:{codex:{close(){},async status(){return {connected:false,models:[]};}}}});
await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})}),page=await browser.newPage({viewport:{width:1250,height:900}});
try{
  await page.goto(`http://127.0.0.1:${app.address().port}/#session=${app.sessionToken}`);
  await page.getByRole('heading',{name:'Saved work recovered'}).waitFor();assert((await page.locator('#dialog').textContent()).includes('original journal'));
  await fs.mkdir('.test-output',{recursive:true});await page.screenshot({path:'.test-output/recovery-notice.png'});await page.keyboard.press('Escape');
  const backup=await app.storage.backup(),copy=await app.storage.restoreCopy(backup.id);assert.equal(path.dirname(copy.restoredPath),copy.dataRoot);assert.equal(path.basename(copy.restoredPath),'workspace');
  assert.equal(app.store.state.messages[0].content,'The saved note stays here.');console.log(JSON.stringify({status:'PASS',noticeVisible:true,originalKept:true,nativeReadyRestoreLayout:true}));
}finally{await browser.close();await app.dispose();}
