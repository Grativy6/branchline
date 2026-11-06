import {api} from './api.js';
import {escapeHtml as e} from './views.js';
import {downloadExport} from './session.js';
import {chairRoster} from './chair-roster.js';
const uid=()=>crypto.randomUUID();
const size=n=>n<1024?n+' bytes':(n/1024).toFixed(1)+' KiB';
const date=s=>new Date(s).toLocaleString();
const code=v=>`<pre class="peach-code">${e(typeof v==='string'?v:JSON.stringify(v,null,2))}</pre>`;
export function createPeaches({getState,refresh,openDialog,openProfile,newProfile,toast}){
  let library=null,current=null,imported=null,saveOperation=null,busy=false,chatId=null,preferredPersonal=null;
  const request=(route='',input=null)=>api.peaches(route,input);
  function show(body){openDialog('Book of PEACHES',`<div class="peaches-book"><fieldset id="peaches-controls" ${busy?'disabled':''}>${body}</fieldset><p id="peaches-error" role="alert" class="message-error" hidden></p></div>`,'settings-dialog peaches-dialog');}
  function setBusy(value){busy=value;const panel=document.getElementById('peaches-controls');if(panel)panel.disabled=value;}
  function error(err){const element=document.getElementById('peaches-error');if(element){element.textContent=err.message;element.hidden=false;}else toast(err.message);}
  async function guarded(fn){if(busy)return;setBusy(true);try{await fn();}catch(err){error(err);}finally{setBusy(false);}}
  async function home(){library=await request();current=null;imported=null;
    const signer=library.signer;
    const connection=preferredPersonal?await request('/connection?'+new URLSearchParams({personal:preferredPersonal})):null;
    show(`<div class="peaches-intro"><img src="/assets/book-of-peaches.svg" alt="" width="72" height="72"><div><h3>A version worth keeping</h3><p>Save useful context, see where it came from, and continue with any model.</p></div></div>
      ${connection?.association?`<div class="peach-entry"><strong>${e(connection.association.thread.origin?.label??'Continuing thread')} → ${e(connection.name)}</strong><span>Current model: ${e(connection.generation?.modelIdentifier??'Unspecified')}</span><span>${e(connection.profileName)} · reviewed ${e(date(connection.reviewedAt))}</span><small>Revision ${e(connection.revision.slice(0,12))} · Origin and history stay with the thread when its model changes.</small></div>`:''}
      <div class="peaches-actions"><button class="primary-button" data-action="peaches-new">Save a version</button><button class="quiet-button" data-action="peaches-open-copy">Open a copy</button><input id="peaches-import" type="file" accept=".zip,.peach.zip" hidden></div>
      <p class="field-help">Free local saving, checking and copies. No Book account needed. Signing is optional; exported copies contain readable text.</p>
      <div class="peaches-entries">${library.entries.map(item=>`<button class="peach-entry" data-action="peaches-view" data-id="${e(item.id)}"><strong>${e(item.title)}</strong><span>${e(item.status)} · ${e(date(item.at))}</span>${item.parent?`<small>${item.relation==='correction'?'Correction of':'Continues'} an earlier version</small>`:''}</button>`).join('')||'<p class="muted peach-empty">Your saved versions will rest here. You can keep one without setting up a key.</p>'}</div>
      ${library.previews.length?`<details><summary>Unfinished saves · ${library.previews.length}</summary>${library.previews.map(p=>`<p><button class="text-button" data-action="peaches-view" data-id="${e(p.id)}">${e(p.title)} · resume exact preview</button></p>`).join('')}</details>`:''}
      ${library.associations.length?`<details><summary>Continuing threads</summary>${library.associations.map(a=>`<p>${e(library.participants.find(p=>p.id===a.personalId)?.name??'Carried profile')} · ${e(a.thread.origin?.label??'No origin selected')} · ${e(a.relationship)}</p>`).join('')}</details>`:''}
      <details><summary>Optional signing${signer.configured?' · '+(signer.unlocked?'unlocked':'locked'):''}</summary><p>Unlock in a separate local window. Locks after 15 idle minutes or when this app closes.</p>${signer.error?`<p class="message-error">${e(signer.error)}</p>`:''}
      ${signer.issuerId?code(signer.issuerId):''}<div class="peaches-actions"><button class="quiet-button" data-action="peaches-signer" data-kind="${signer.configured?'unlock':'setup'}">${signer.configured?'Unlock':'Set up a personal key'}</button>${signer.configured?'<button class="quiet-button" data-action="peaches-signer" data-kind="lock">Lock</button><button class="quiet-button" data-action="peaches-signer" data-kind="backup">Save encrypted recovery key</button><button class="text-button" data-action="peaches-signer" data-kind="setup">Use another key / restore</button>':''}</div>
      ${signer.configured&&!signer.recoverySaved?'<p class="field-help">An encrypted recovery copy is still worth saving. Losing your key never locks you out of reading this Book.</p>':''}</details>`);
  }
  function newVersion(selectedProfile=null){
    const state=getState(),chat=state.chats.find(c=>c.id===chatId),personalId=preferredPersonal??(chat?chairRoster(state,chat).desk.personalId:null);
    const binding=state.personalContext?.bindings?.findLast(b=>b.chatId===chatId&&b.profileId);
    const association=library.associations.findLast(a=>a.personalId===personalId);
    const profile=selectedProfile??association?.profileId??binding?.profileId??library.profiles[0]?.id;
    if(!library.profiles.length){return newProfile(chatId,async id=>{library=await request();if(id)newVersion(id);else await home();});}
    show(`<form id="peaches-prepare" data-operation="${uid()}"><p>Choose what travels. The next page freezes the exact account for your review.</p>
      <label class="form-field">Version name<input name="title" required maxlength="200" value="${e((library.profiles.find(p=>p.id===profile)?.name??'Personal continuity')+' · '+new Date().toLocaleDateString())}"></label>
      <label class="form-field">Reviewed profile<select name="profileId">${library.profiles.map(p=>`<option value="${e(p.id)}" ${p.id===profile?'selected':''}>${e(p.name)}</option>`).join('')}</select></label>
      <label class="form-field">Continuity thread (optional)<select name="personalId"><option value="">Save the profile on its own</option>${library.participants.map(p=>`<option value="${e(p.id)}" ${p.id===personalId?'selected':''}>${e(p.name)}</option>`).join('')}</select></label>
      <label class="form-field">Kept by<input name="adoptedBy" maxlength="200" required value="${e(association?.adoptedBy??'Local user')}"></label>
      <details><summary>Origin and earlier versions</summary><p class="field-help">An existing connection keeps its origin and continuing-thread identity. It does not change earlier replies or which model answers.</p>
      <label class="form-field">Origin for a new thread<select name="origin"><option value="none">Start without an origin</option><option value="h1" ${association?.thread.origin?.label==='H1'?'selected':''}>H1 · Chris's published Hearthline origin</option><option value="custom">Choose another signed origin</option></select></label><label class="form-field">Optional origin envelope<input name="originFile" type="file" accept=".json"></label>
      <label class="form-field">Relationship<select name="relation"><option value="checkpoint">Next checkpoint</option><option value="correction">Correction of the previous version</option></select></label>
      ${library.participants.length>1?`<p>Earlier participants in this history, if relevant:</p>${library.participants.filter(p=>p.id!==personalId).map(p=>`<label class="check-line"><input type="checkbox" name="predecessor" value="${e(p.id)}">${e(p.name)}</label>`).join('')}`:''}</details>
      <div class="dialog-footer"><button class="quiet-button" type="button" data-action="peaches-home">Back</button><button class="primary-button" type="submit">Preview this version</button></div></form>`);
  }
  function contents(r){const m=r.manifest,c=r.bundle.content;
    return `<h3>${e(m.title)}</h3><p class="peach-status">${e(r.status)} · ${size(r.expandedBytes)} · ${e(date(m.createdAt))}</p>
      <p>${e(m.thread.origin?.label??'No origin selected')} · ${e(m.source.participant?.name??c.name)}${m.source.generation?` · ${e(m.source.generation.modelIdentifier??'Recorded generation')}`:''}</p>
      <details open><summary>Orientation</summary><div class="harness-text">${e(c.orientation||'No extra orientation.')}</div></details>
      <details open><summary>Reviewed account</summary><div class="harness-text">${e(c.account||'No account text.')}</div></details>
      <details><summary>Sources · ${c.sources.length} current, ${r.bundle.historicalSources.length} historical</summary>${[...c.sources,...r.bundle.historicalSources].map(s=>`<details><summary>${e(s.title)} · ${e(s.kind)}</summary><p class="field-help">${e(s.origin)}</p><div class="harness-text">${e(s.text)}</div></details>`).join('')||'<p>No source snapshots selected.</p>'}</details>
      <details><summary>History and original attribution · ${r.bundle.history.length} records</summary>${r.bundle.history.map(row=>`<details><summary>${e(row.event)} · ${e(row.author?.model??row.author?.kind??'Recorded source')} · ${e(row.at??'')}</summary>${code(row)}</details>`).join('')}</details>
      ${m.parent?`<p class="field-help">${m.relation==='correction'?'Corrects':'Continues'} an earlier version. ${r.parentPresent===false?'The parent is not in this local Book yet.':''}</p>`:''}
      ${r.signature&&r.origin?`<p class="field-help">${r.signerMatchesOrigin?'The presented signing key matches the origin key.':'This version uses a different signing key from its origin. No endorsement by the origin signer is established.'}</p>`:''}
      <details><summary>Details and exact references</summary><p>These checks bind the saved bytes. They do not grant tools, provider access or authority over another thread.</p><p>Snapshot digest</p>${code(r.snapshotSha256)}${r.signature?`<p>Signature envelope digest</p>${code(r.signature.envelopeSha256)}${code(r.signature)}`:''}<p>Manifest</p>${code(r.exactManifest??m)}${r.exactContinuity?`<details><summary>Exact continuity export</summary>${code(r.exactContinuity)}</details>`:''}${r.originEnvelope?`<details><summary>Original signed origin envelope</summary>${code(r.originEnvelope)}</details>`:''}</details>`;
  }
  function review(r,{preview=false,opening=false}={}){current=r;if(r.record)imported=null;saveOperation=uid();show(`${contents({...r,status:preview?'Ready to save · frozen preview':opening&&!r.signature?'Contents checked · unsigned copy':r.status})}
      ${preview?'<p class="field-help">This is a frozen version. Later profile changes will belong to another save.</p>':''}
      <div class="dialog-footer"><button class="quiet-button" data-action="peaches-home">Back to Book</button>
      ${opening?'<button class="quiet-button" data-action="peaches-keep">Keep a copy</button><button class="primary-button" data-action="peaches-continue">Continue here</button>':preview?'<button class="primary-button" data-action="peaches-save">Save version</button><details class="peach-optional-signature"><summary>Add an optional signature</summary><p class="field-help">You can also save now and sign this exact version later.</p><button class="quiet-button" data-action="peaches-stamp">Sign and save</button></details>':`<button class="quiet-button" data-action="peaches-export">Export copy</button>${!r.signature?'<button class="quiet-button" data-action="peaches-stamp">Stamp this version</button>':''}<button class="primary-button" data-action="peaches-continue">Continue here</button>`}</div>`);}
  function continueForm(){show(`${contents(current)}<form id="peaches-continue-form" data-operation="${uid()}"><h3>Bring this account here</h3><p>Creates a separate local profile and preserves the source history. Choose a Desk Model or visitor to use it with next. The saved history keeps its original authorship.</p>
    <label class="form-field">Continuity thread (optional)<select name="personalId"><option value="">Profile only — choose a model next</option>${library.participants.map(p=>`<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}</select></label>
    <label class="form-field">Carried history<select name="relationship"><option value="continuation">Continue this thread</option><option value="branch">Start a branch from it</option></select></label>
    <label class="form-field">Kept by<input name="adoptedBy" value="Local user" maxlength="200" required></label>
    <button class="primary-button" type="submit">Continue with this context</button></form>`);}
  async function action(action,target){if(!action.startsWith('peaches-'))return false;
    await guarded(async()=>{
      if(action==='peaches-home')await home();
      else if(action==='peaches-open-copy')document.getElementById('peaches-import').click();
      else if(action==='peaches-new')await newVersion();
      else if(action==='peaches-view'){const r=await request('/view?'+new URLSearchParams({id:target.dataset.id}));review(r,{preview:!r.record.status});}
      else if(action==='peaches-save'||action==='peaches-stamp'){
        const r=await request('/save',{operation:saveOperation,previewId:current.record.id,stamp:action==='peaches-stamp'});await refresh();review(r);toast('Version kept in your Book.');
      }else if(action==='peaches-keep'){
        const r=await request('/keep',{operation:saveOperation,archive:imported});await refresh();review(r);toast('Copy kept locally.');
      }else if(action==='peaches-export')await downloadExport('/api/peaches/export?'+new URLSearchParams({id:current.record.id}),'continuity.peach.zip');
      else if(action==='peaches-continue')continueForm();
      else if(action==='peaches-signer'){await request('/signer',{action:target.dataset.kind});await home();}
    });return true;
  }
  async function submit(event){if(!event.target.id.startsWith('peaches-'))return false;event.preventDefault();
    const form=event.target,values=new FormData(form);
    await guarded(async()=>{
      if(form.id==='peaches-prepare'){
        let originEnvelope=null;if(values.get('origin')==='custom'){const file=values.get('originFile');if(!file?.size||file.size>600000)throw new Error('Choose a signed Floor JSON envelope smaller than 600 KB.');originEnvelope=encodeFile(await file.arrayBuffer());}
        const r=await request('/prepare',{operation:form.dataset.operation,title:values.get('title'),profileId:values.get('profileId'),personalId:values.get('personalId')||null,adoptedBy:values.get('adoptedBy'),origin:values.get('origin'),originEnvelope,relation:values.get('relation'),predecessorIds:values.getAll('predecessor')});review(r,{preview:true});
      }else if(form.id==='peaches-continue-form'){
        if(!current.record){current=await request('/keep',{operation:saveOperation,archive:imported});imported=null;}
        const r=await request('/continueHere',{operation:form.dataset.operation,id:current.record.id,personalId:values.get('personalId')||null,relationship:values.get('relationship'),adoptedBy:values.get('adoptedBy')});await refresh();await openProfile(r.profileId,chatId);
      }
    });return true;
  }
  async function change(event){if(event.target.id!=='peaches-import')return false;const file=event.target.files[0];if(!file)return true;
    await guarded(async()=>{if(file.size>1024*1024)throw new Error('Choose a copy smaller than 1 MiB.');imported=encodeFile(await file.arrayBuffer());const r=await request('/open',{archive:imported});review(r,{opening:true});});return true;
  }
  function encodeFile(buffer){const data=new Uint8Array(buffer);let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(binary);}
  return {open:async(chat=null,personal=null)=>{chatId=chat;preferredPersonal=personal;await home();},action,submit,change};
}
