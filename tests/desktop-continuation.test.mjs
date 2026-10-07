import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { profileDestination } from '../server/agent-profiles.mjs';
import { fixture, deferred, listen } from './helpers.mjs';
import { activeCarry, readyCarry, chatMessages, sourceAt } from '../server/context-carry.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';
import { createApp } from '../server/index.mjs';
import { RESOURCE_DEFAULTS, CARRY_DEFAULTS } from '../public/resource-settings.js';
import { decodeSelectedFile, readDocumentPage } from '../server/selected-file.mjs';

const account = JSON.stringify({account:'Chris corrected the plan: the shelf is blue, not red. Vega suggested red; Chris chose blue [M1]. The question of which pot remains open. No permission to buy anything.'});
const input=f=>({chatId:f.chatId,speaker:'visiting',baseId:activeCarry(f.app.store.state,f.chatId)?.id??null,lastMessageId:chatMessages(f.app.store.state,f.chatId).at(-1).id});
async function seed(f) {
  await f.command('message.note',{chatId:f.chatId,content:'Vega proposed red. Chris corrected it to blue. Which pot is unresolved. No purchases authorized.'});
  for(let i=0;i<22;i++) await f.command('message.note',{chatId:f.chatId,content:'Source '+i+'. '+'The workshop account remains evidence. '.repeat(48)});
  f.responseText=account;
}
const reply=(res,text)=>res.end(JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));

test('fixed cutoff survives overlapping HTTP reply, correction and draft; ready account activates only at next reply',async t=>{
  const f=await fixture(t); await seed(f);
  await f.command('root.update',{id:f.rootId,instructions:'Keep the selected guidance exact.'});
  await f.command('draft.save',{chatId:f.chatId,text:'UNSENT_PRIVATE_DRAFT'});
  const originals=structuredClone(f.app.store.state.messages), started=deferred(), release=deferred(); t.after(()=>release.resolve());
  f.handler=async(body,res)=>{
    if(body.messages[0].content.includes('desk\'s recorder')) {started.resolve();await release.promise;reply(res,account);}
    else reply(res,'The newer answer from the original model.');
  };
  const pending=f.post('/api/context-carry/prepare',input(f));await started.promise;
  const frozen=structuredClone(f.app.store.state.contextCarry.jobs.at(-1));
  const overlapping=await f.post('/api/exchange',{chatId:f.chatId,content:'An actual overlapping new turn.'}); assert.equal(overlapping.status,200,JSON.stringify(overlapping.body));
  await f.command('message.note',{chatId:f.chatId,content:'NEWER_CORRECTION: the shelf should now be green; pot remains unresolved.'});
  await f.command('draft.save',{chatId:f.chatId,text:'UNSENT_PRIVATE_DRAFT with another thought'});
  release.resolve();const result=await pending;assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(activeCarry(f.app.store.state,f.chatId),null);assert(readyCarry(f.app.store.state,f.chatId));
  assert.deepEqual(f.app.store.state.messages.slice(0,originals.length),originals);
  assert.equal(f.app.store.state.contextCarry.jobs[0].through,frozen.through);
  assert(!f.requests[0].messages.some(m=>m.content.includes('UNSENT_PRIVATE_DRAFT')||m.content.includes('NEWER_CORRECTION')));
  assert.equal(f.requests[0].tools,undefined);
  const tail=structuredClone(chatMessages(f.app.store.state,f.chatId).slice(frozen.through));
  f.handler=null; f.responseText='I see the green correction and the open pot question.';
  assert.equal((await f.post('/api/exchange',{chatId:f.chatId,content:'Continue with the correction.'})).status,200);
  assert(activeCarry(f.app.store.state,f.chatId));assert.equal(readyCarry(f.app.store.state,f.chatId),null);
  const prompt=f.requests.at(-1).messages;
  for(const m of tail) assert.equal(prompt.filter(p=>p.content.includes(m.content)).length,1,'tail exactly once: '+m.id);
  assert(prompt.some(m=>m.content.includes('NEWER_CORRECTION')));
  assert.equal(f.app.store.state.drafts[f.chatId],'UNSENT_PRIVATE_DRAFT with another thought');
  assert.equal(f.app.store.state.roots[0].instructions.at(-1).text,'Keep the selected guidance exact.');
});

test('review, cancellation, changed guidance and restart cannot silently activate or resubmit a prepared account',async t=>{
  const f=await fixture(t);await seed(f);
  await f.command('chat.carrySettings',{id:f.chatId,settings:{...CARRY_DEFAULTS,speaker:'visiting',review:true}});
  assert.equal((await f.post('/api/context-carry/prepare',input(f))).status,200);
  const id=readyCarry(f.app.store.state,f.chatId).id;
  f.responseText='Ordinary reply before review.';assert.equal((await f.post('/api/exchange',{chatId:f.chatId,content:'Continue without adopting.'})).status,200);
  assert.equal(activeCarry(f.app.store.state,f.chatId),null);
  await f.command('carry.approve',{chatId:f.chatId,baseId:null,recordId:id});
  const count=f.requests.length;
  await f.app.dispose();f.app=await createApp({dataDir:f.dataDir,backupDir:f.backupDir});f.url=await listen(f.app);
  assert.equal(f.requests.length,count);assert.equal(readyCarry(f.app.store.state,f.chatId).id,id);
  await f.command('root.update',{id:f.rootId,instructions:'A new adopted instruction after preparation.'});
  const held=await f.post('/api/exchange',{chatId:f.chatId,content:'This needs a fresh check.'});
  assert.equal(held.status,400);assert.match(held.body.error,/base, guidance or sources changed/);assert.equal(f.requests.length,count);
  assert.equal((await f.post('/api/cancel',{chatId:f.chatId})).status,200);await until(()=>!readyCarry(f.app.store.state,f.chatId));assert.equal(readyCarry(f.app.store.state,f.chatId),null);
  assert.equal(f.app.store.state.contextCarry.records.length,1);
});

test('an intentional model swap retains the Coat and shared account while original speakers remain attributed',async t=>{
  const f=await fixture(t);await seed(f);
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:null,visitorModelId:f.app.store.state.models[0].id});
  const send=content=>f.post('/api/exchange',{chatId:f.chatId,kind:'send',speaker:'visiting',content,requestId:'req_'+crypto.randomUUID(),baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,lastMessageId:lastMessageId(f.app.store.state,f.chatId)});
  f.responseText='Original speaker proposes a square pot.';assert.equal((await send('What about a pot?')).status,200);
  const coat=structuredClone(f.app.store.state.chats[0].harnessSelections), previous=structuredClone(f.app.store.state.messages.at(-1));
  f.responseText=account;assert.equal((await f.post('/api/context-carry/prepare',input(f))).status,200);
  await f.command('model.save',{name:'Second synthetic connection',model:'other-model',baseUrl:f.app.store.state.models[0].baseUrl});
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,personalId:null,visitorModelId:f.app.store.state.models.at(-1).id});
  f.responseText='The green shelf and pot question carry forward.';assert.equal((await send('Continue on this connection.')).status,200);
  assert.deepEqual(f.app.store.state.chats[0].harnessSelections,coat);assert.deepEqual(f.app.store.state.messages.find(m=>m.id===previous.id),previous);
  const prompt=f.requests.at(-1);assert.equal(prompt.model,'other-model');
  assert(prompt.messages.some(m=>m.content.includes('Original speaker proposes a square pot.')&&m.content.includes('another participant')));
  assert(prompt.messages.some(m=>m.content.includes('Chris corrected the plan')));
  assert.equal(f.app.store.state.contextCarry.records.length,1);
});

test('128 KiB text stays byte-exact, paginates Unicode, bounds prompt intake and exposes no filesystem',async t=>{
  const f=await fixture(t), text='\uFEFF'+('🌱 e\u0301\r\n'.repeat(14500))+'FINAL_SOURCE_MARKER';
  const bytes=Buffer.from(text);assert(bytes.length>=131072);
  const file={name:'large.txt',base64:bytes.toString('base64')};
  await f.command('root.resources',{id:f.rootId,resources:{...RESOURCE_DEFAULTS,fileBytes:262144}});
  assert.equal((await f.post('/api/exchange',{chatId:f.chatId,content:'Read in bounded passages.',selectedFile:file})).status,200);
  const saved=f.app.store.state.exchanges[0].selectedFile;
  assert.deepEqual(Buffer.from(saved.text),bytes);assert.equal(saved.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  assert(!f.requests[0].messages.some(m=>m.content.includes('FINAL_SOURCE_MARKER')));
  let offset=0, reconstructed='';do{const page=readDocumentPage(saved,offset);assert(page.text.length<=4000);reconstructed+=page.text;offset=page.nextOffset;}while(offset!==null);
  assert.equal(reconstructed,text);assert.throws(()=>readDocumentPage(saved,2),/complete Unicode/);
  assert.equal(sourceAt(f.app.store.state,f.chatId,'M1').attachment.sha256,saved.sha256);
  const exact128={name:'128.txt',base64:Buffer.alloc(131072,65).toString('base64')};
  assert.equal(decodeSelectedFile(exact128).byteLength,131072);
});

test('resource settings reach actual requests, reset to provider default and ignore historical length names',async t=>{
  const f=await fixture(t);
  await f.app.store.transact(s=>{s.roots[0].replyLength='short';return s;});
  assert.equal((await f.post('/api/exchange',{chatId:f.chatId,content:'Default reply.'})).status,200);assert.equal(f.requests.at(-1).max_tokens,undefined);
  await f.command('root.resources',{id:f.rootId,resources:{...RESOURCE_DEFAULTS,replyTokens:4096}});
  assert.equal((await f.post('/api/exchange',{chatId:f.chatId,content:'Configured reply.'})).status,200);assert.equal(f.requests.at(-1).max_tokens,4096);
  await f.command('root.resources',{id:f.rootId,resources:{...RESOURCE_DEFAULTS}});
  assert.equal((await f.post('/api/exchange',{chatId:f.chatId,content:'Reset reply.'})).status,200);assert.equal(f.requests.at(-1).max_tokens,undefined);
  assert.equal(f.app.store.state.roots[0].replyLength,'short');
  assert.equal((await f.post('/api/command',{type:'root.resources',payload:{id:f.rootId,resources:{...RESOURCE_DEFAULTS,replyTokens:-1}}})).status,400);
});

const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,15));}throw new Error('Expected local state did not arrive');};
test('a recorder queued behind a reply freezes the earlier cutoff; Stop cancels both without a late dispatch',async t=>{
 const f=await fixture(t);await seed(f);const frozen=input(f),started=deferred(),release=deferred();t.after(()=>release.resolve());
 f.handler=async(body,res)=>{if(body.messages[0].content.includes("desk's recorder"))reply(res,account);else{started.resolve();await release.promise;reply(res,'Finished ordinary reply.');}};
 const pending=f.post('/api/exchange',{chatId:f.chatId,content:'An ordinary request holds the connection.'});await started.promise;
 const receipt=await f.post('/api/context-carry/start',frozen);assert.equal(receipt.status,202);assert.equal(receipt.body.status,'queued');
 assert.equal((await f.post('/api/cancel',{chatId:f.chatId})).status,200);release.resolve();assert.equal((await pending).status,409);
 await until(()=>f.app.store.state.exchanges.every(e=>e.status!=='pending'));await new Promise(r=>setTimeout(r,250));
 assert.equal(f.requests.length,1);assert.equal(readyCarry(f.app.store.state,f.chatId),null);
});
test('queued preparation completes after the occupying reply with its entire appended tail retained',async t=>{
 const f=await fixture(t);await seed(f);const frozen=input(f),started=deferred(),release=deferred();t.after(()=>release.resolve());
 f.handler=async(body,res)=>{if(body.messages[0].content.includes("desk's recorder"))reply(res,account);else{started.resolve();await release.promise;reply(res,'The appended tail is still here.');}};
 const pending=f.post('/api/exchange',{chatId:f.chatId,content:'Append this while a preparation is queued.'});await started.promise;
 assert.equal((await f.post('/api/context-carry/start',frozen)).body.status,'queued');release.resolve();assert.equal((await pending).status,200);
 await until(()=>readyCarry(f.app.store.state,f.chatId));assert.equal(activeCarry(f.app.store.state,f.chatId),null);
 assert(!f.requests.at(-1).messages.some(m=>m.content.includes('Append this while')));
 f.handler=null;f.responseText='Continued.';assert.equal((await f.post('/api/exchange',{chatId:f.chatId,content:'Continue.'})).status,200);
 assert(f.requests.at(-1).messages.some(m=>m.content.includes('The appended tail is still here.')));
});
test('automatic recorder is opt-in and connection-bound; Stop persists its pause across restart',async t=>{
 const f=await fixture(t,{modelOptions:{maxContextCharacters:24000}});await seed(f);assert.equal(f.requests.length,0);
 const started=deferred(),release=deferred();t.after(()=>release.resolve());f.handler=async(body,res)=>{started.resolve();await release.promise;reply(res,account);};
 await f.command('chat.carrySettings',{id:f.chatId,settings:{...CARRY_DEFAULTS,automatic:true,speaker:'visiting'}});await started.promise;
 await f.post('/api/cancel',{chatId:f.chatId});release.resolve();await until(()=>f.app.store.state.contextCarry.jobs.at(-1).status!=='pending');
 assert.equal(f.app.store.state.chats[0].carrySettings.automatic,true);assert.equal(f.app.store.state.chats[0].workStopped,true);const calls=f.requests.length;
 await f.app.dispose();f.app=await createApp({dataDir:f.dataDir,backupDir:f.backupDir});f.url=await listen(f.app);await f.command('draft.save',{chatId:f.chatId,text:'After restart'});
 await new Promise(r=>setTimeout(r,200));assert.equal(f.requests.length,calls);assert.equal(readyCarry(f.app.store.state,f.chatId),null);
});

// These destination checks use loopback fixtures, not provider accounts.
test('a ready account remains unactivated when the destination needs sharing review',async t=>{
 const f=await fixture(t);await seed(f);const m=f.app.store.state.models[0];
 await f.command('personal.create',{name:'Synthetic personal',modelId:m.id,baseIdentity:'synthetic/base'});const personal=f.app.store.state.personalParticipants[0];
 await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:personal.id,visitorModelId:m.id});
 await f.command('profile.import',{bundle:{schema:'branchline.agent-profile/1',name:'Synthetic guidance',description:'Test only',entries:[{path:'AGENTS.md',role:'guidance',scope:'agent',text:'Retain the garden sources.',source:null}]},replaces:null});
 const profile=f.app.store.state.agentProfiles.profiles[0];
 await f.command('profile.connect',{personalId:personal.id,baseSelectionId:null,profileId:profile.id,paths:['AGENTS.md'],models:[{id:m.id,destination:profileDestination(m)}]});
 f.responseText='A reply with the selected profile in its recorded context.';
 assert.equal((await f.post('/api/exchange',{chatId:f.chatId,speaker:'personal',kind:'send',requestId:'request_'+crypto.randomUUID(),baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,lastMessageId:lastMessageId(f.app.store.state,f.chatId),content:'Start with this selected guidance.'})).status,200);
 f.responseText=account;
 assert.equal((await f.post('/api/context-carry/prepare',input(f))).status,200);
 const ready=readyCarry(f.app.store.state,f.chatId).id;
 await f.command('model.save',{name:'Uncleared synthetic visitor',model:'new-model',baseUrl:m.baseUrl});
 await f.command('table.assign',{chatId:f.chatId,baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,personalId:personal.id,visitorModelId:f.app.store.state.models.at(-1).id});
 await f.command('draft.save',{chatId:f.chatId,text:'KEEP THIS DRAFT'});const before=structuredClone(f.app.store.state.messages),calls=f.requests.length;
 const held=await f.post('/api/exchange',{chatId:f.chatId,speaker:'visiting',kind:'send',requestId:'request_'+crypto.randomUUID(),baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,lastMessageId:lastMessageId(f.app.store.state,f.chatId),content:'Continue.'});
 assert.equal(held.status,400);assert.match(held.body.error,/sharing|not cleared/);assert.equal(f.requests.length,calls);
 assert.equal(activeCarry(f.app.store.state,f.chatId),null);assert.equal(readyCarry(f.app.store.state,f.chatId).id,ready);
 assert.deepEqual(f.app.store.state.messages,before);assert.equal(f.app.store.state.drafts[f.chatId],'KEEP THIS DRAFT');
});
test('a smaller destination cannot activate an account by dropping its newer tail',async t=>{
 const f=await fixture(t);await seed(f);assert.equal((await f.post('/api/context-carry/prepare',input(f))).status,200);
 const id=readyCarry(f.app.store.state,f.chatId).id;await f.command('message.note',{chatId:f.chatId,content:'NEWER TAIL '+ 'All these words remain saved. '.repeat(300)});
 let dispatches=0;const metadata=http.createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/v1/models')res.end(JSON.stringify({models:[{loaded_instances:[{id:'small-model',config:{context_length:4096}}]}]}));else{dispatches++;res.statusCode=500;res.end('{}');}});
 const address=await listen(metadata);t.after(()=>new Promise(r=>{metadata.closeAllConnections();metadata.close(r);}));
 await f.command('model.save',{name:'Small simulated window',model:'small-model',runtime:'lmstudio',baseUrl:address+'/v1'});await f.command('root.model',{id:f.rootId,modelId:f.app.store.state.models.at(-1).id});
 await f.command('draft.save',{chatId:f.chatId,text:'UNSENT BEFORE SMALL WINDOW'});const history=structuredClone(f.app.store.state.messages);
 const held=await f.post('/api/exchange',{chatId:f.chatId,content:'Continue.'});assert.equal(held.status,400);assert.match(held.body.error,/working-context limit/);
 assert.equal(dispatches,0);assert.equal(activeCarry(f.app.store.state,f.chatId),null);assert.equal(readyCarry(f.app.store.state,f.chatId).id,id);
 assert.deepEqual(f.app.store.state.messages,history);assert.equal(f.app.store.state.drafts[f.chatId],'UNSENT BEFORE SMALL WINDOW');
});
