import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { addLegacyDesk } from './legacy-desks-fixture.mjs';
import { Store } from '../server/store.mjs';
import { replayJournal } from '../server/journal.mjs';
import { validateState } from '../server/domain.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';
import { allHarnesses, findHarness } from '../public/harness-catalog.js';
import { harnessDialog } from '../public/harness-views.js';

test('retired desk creation is rejected without changing the workspace', async t => {
  const f=await fixture(t), before=structuredClone(f.app.store.state);
  for(const p of [{mode:'fs'},{mode:'personal',workspaceKind:'tend'},{mode:'fs',workspaceKind:'tend'},{mode:'personal',workspaceKind:'terminal'},{mode:'personal',workspaceKind:null}]) {
    const result=await f.post('/api/command',{type:'root.create',payload:{name:'Retired creation',...p}});
    assert.equal(result.status,400); assert.deepEqual(f.app.store.state,before);
  }
  const invalid=structuredClone(before);invalid.roots[0].workspaceKind='terminal';assert.throws(()=>validateState(invalid),/workspace kind/);
  await f.command('root.create',{name:'An ordinary desk',mode:'personal',setupChairs:true});
  assert.equal(f.app.store.state.roots.at(-1).workspaceKind,undefined);
  assert.equal(f.app.store.state.chats.at(-1).harnessSelections,undefined);
  assert.equal(f.requests.length,0);
});

test('saved retired desks retain exact Coats, drafts and history through replies and replay', async t => {
  const f=await fixture(t);
  for(const kind of ['tend','fs']) {
    const {root,chat,coat}=await addLegacyDesk(f,kind);
    assert.deepEqual(findHarness(coat.preset,f.app.store.state),coat.preset);
    await f.command('message.note',{chatId:chat.id,content:'Earlier synthetic '+kind+' note.'});
    await f.command('draft.save',{chatId:chat.id,text:'Unsent '+kind+' draft 🌱'});
    await f.command('table.assign',{chatId:chat.id,baseRevisionId:currentAssignment(f.app.store.state,chat.id).id,personalId:null,visitorModelId:f.app.store.state.models[0].id});
    const response=await f.post('/api/exchange',{chatId:chat.id,kind:'send',speaker:'visiting',content:'Continue this existing conversation.',requestId:'legacy_'+kind,baseRevisionId:currentAssignment(f.app.store.state,chat.id).id,lastMessageId:lastMessageId(f.app.store.state,chat.id),harnessRevisionId:chat.harnessSelections[0].id});
    assert.equal(response.status,200,JSON.stringify(response.body));
    const turn=f.app.store.state.exchanges.at(-1);
    assert.deepEqual(turn.harness.preset,coat.preset);assert.equal(turn.harness.hash,coat.hash);
    assert.ok(f.requests.at(-1).messages[0].content.includes(coat.preset.instructions));
    await f.command('draft.save',{chatId:chat.id,text:'Still unsent '+kind+' 🌱'});
    await f.command('chat.create',{rootId:root.id,title:'Another existing-desk branch',setupChairs:true});
    assert.deepEqual(f.app.store.state.chats.at(-1).harnessSelections[0].personal,chat.harnessSelections[0].personal);
  }
  await f.app.store.requestCheckpoint();const before=structuredClone(f.app.store.state);
  assert.deepEqual((await replayJournal(f.app.store.file)).state,before);
  const backup=await f.post('/api/storage/backup');assert.equal(backup.status,201);
  assert.equal((await f.post('/api/storage/verify',{id:backup.body.backup.id})).status,200);
  for (const key of ['roots','chats','messages','exchanges','drafts']) assert.deepEqual(f.app.store.state[key],before[key]);
  const afterBackup=structuredClone(f.app.store.state); // Backup operations append their own receipts.
  await f.app.store.close();const reopened=new Store(f.dataDir);await reopened.open();
  try {assert.deepEqual(reopened.state,afterBackup);} finally {await reopened.close();}
});

test('retired starters leave the library while an existing selection stays explicit and saveable', async t => {
  const f=await fixture(t);
  assert.ok(allHarnesses(f.app.store.state).every(h=>!['tend','finis-solutus'].includes(h.id)));
  const before=structuredClone(f.app.store.state);
  const payload={chatId:f.chatId,baseRevisionId:null,baseDefaultId:null,shared:true,personal:{id:'tend',version:1},visiting:{id:'tend',version:1},saveAsDefault:false};
  assert.equal((await f.post('/api/command',{type:'harness.select',payload})).status,400);
  assert.deepEqual(f.app.store.state,before);
  const {root,chat}=await addLegacyDesk(f,'tend');
  const markup=harnessDialog(f.app.store.state,root,chat);
  assert.match(markup,/value="tend" selected>Tend · starter · retired, kept here/);
  assert.doesNotMatch(markup,/value="finis-solutus"/);
  await f.command('harness.select',{...payload,chatId:chat.id,baseRevisionId:chat.harnessSelections[0].id});
  assert.equal(f.app.store.state.chats.find(c=>c.id===chat.id).harnessSelections.at(-1).personal.id,'tend');
});
