import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const [repo,output]=process.argv.slice(2).map(p=>path.resolve(p));
const {fixture,deferred}=await import(pathToFileURL(path.join(repo,'tests/helpers.mjs')));
const {chromium}=createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const cleanup=[], f=await fixture({after:fn=>cleanup.push(fn)},{modelOptions:{timeoutMs:60000}});
const report={kind:'REAL_EDGE_WITH_SYNTHETIC_SERVER_AND_CONTROLLED_RESPONSE_ORDER',finding:'F3',status:'RUNNING',errors:[]};
const held=deferred(), release=deferred();
let browser,page,response,background,armed=false,intercepted=false;
const duringSave=process.argv[4]==='during-save',saveHeld=deferred(),saveRelease=deferred();
let saveIntercepted=false;
await fs.mkdir(output,{recursive:true});
const oldText='Earlier saved draft.';
const newText=oldText+' NEW WORDS that must survive.';
try {
  await f.command('chat.create',{rootId:f.rootId,title:'Draft under review'});
  const b=f.app.store.state.chats.at(-1).id;
  report.chatId=b;
  await f.command('draft.save',{chatId:b,text:oldText});
  await f.command('ui.update',{selected:{personal:{rootId:f.rootId,chatId:b}},welcomeTour:{version:1,completedAt:new Date().toISOString(),skipped:true}});
  f.handler=(_body,res)=>{response=res;};
  background=f.exchange('Synthetic background work in sibling branch.');
  for(let i=0;!response&&i<200;i++) await new Promise(r=>setTimeout(r,20));
  assert(response,'Synthetic background reply entered its held response');
  browser=await chromium.launch({executablePath:process.env.BRANCHLINE_TEST_BROWSER,headless:true});
  page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin!==f.url) return route.abort('blockedbyclient');
    if(duringSave && u.pathname==='/api/command' && !saveIntercepted && route.request().postDataJSON()?.payload?.text===newText) { saveIntercepted=true;saveHeld.resolve();await saveRelease.promise; }
    if(u.pathname==='/api/state'&&armed&&!intercepted) {
      intercepted=true;
      const reply=await route.fetch({headers:{...route.request().headers(),'if-none-match':''}});
      assert.equal(reply.status(),200,'Capture an actual new server snapshot');
      const bytes=await reply.body(),state=JSON.parse(bytes);
      report.capturedDraft=state.drafts[b];
      report.capturedEtag=reply.headers().etag;
      held.resolve();
      await release.promise;
      return route.fulfill({response:reply,body:bytes});
    }
    return route.continue();
  });
  await page.goto(f.uiUrl);
  await page.locator('.home-resume-button').first().click();
  await page.waitForFunction(text=>document.querySelector('#message-input').value===text,oldText);
  assert.equal(await page.locator('#message-input').isEnabled(),true);
  // Give the poll a fresh server revision with the old draft still intact.
  await f.command('draft.save',{chatId:b,text:oldText});
  if(duringSave) { await page.locator('#message-input').fill(newText); await saveHeld.promise; }
  armed=true;
  await Promise.race([held.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('State poll not captured')),12000))]);
  assert.equal(report.capturedDraft,oldText);
  if(duringSave) saveRelease.resolve(); else await page.locator('#message-input').fill(newText);
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Draft saved');
  assert.equal(f.app.store.state.drafts[b],newText);
  report.serverDraftBeforeRelease=f.app.store.state.drafts[b];
  release.resolve();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#message-input').inputValue(),newText);
  report.composerAfterStaleResponse=await page.locator('#message-input').inputValue();
  report.serverDraftBeforeContinuedTyping=f.app.store.state.drafts[b];
  // Continuing typing after the delayed response must retain the newer words.
  const continued=newText+' Continuing from what is visible.';
  await page.locator('#message-input').fill(continued);
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Draft saved');
  report.serverDraftAfterContinuedTyping=f.app.store.state.drafts[b];
  assert.equal(report.serverDraftAfterContinuedTyping,continued);
  assert(report.serverDraftAfterContinuedTyping.includes('NEW WORDS'));
  await page.screenshot({path:path.join(output,'draft-race.png')});
  assert.deepEqual(report.errors,[]);
  report.status='PASS_STALE_RESPONSE_CANNOT_REVERT_SAVED_DRAFT';
} catch(error) {
  report.status='CHECK_FAILED';report.error=error.stack;process.exitCode=1;
  await page?.screenshot({path:path.join(output,'draft-race-failure.png')}).catch(()=>{});
} finally {
  release.resolve();saveRelease.resolve();
  await browser?.close();
  if(response&&!response.writableEnded) {
    response.setHeader('content-type','application/json');
    response.end(JSON.stringify({choices:[{message:{content:'Synthetic work completed.'},finish_reason:'stop'}]}));
  }
  await background?.catch(error=>{report.backgroundError=error.message;});
  for(const fn of cleanup.reverse()) await fn();
  report.pollBeganDuringSave=duringSave;report.workspace=f.dataDir;report.syntheticModelRequests=f.requests.length;
  await fs.writeFile(path.join(output,'draft-race.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
