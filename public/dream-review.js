import { createSettingsSize } from './settings-size.js';
import { escapeHtml as e } from './views.js';
import { downloadExport } from './session.js';
import { visiblePersonalModels, dreamOwner, DREAM_OUTCOMES } from './dream-records.js';
import { personalLabel } from './personal-label.js';

const button=(action,label,extra='',cls='quiet-button')=>`<button type="button" class="${cls}" data-dream-action="${action}" ${extra}>${label}</button>`;
const options=(values,value)=>values.map(([key,label])=>`<option value="${e(key)}" ${key===value?'selected':''}>${e(label)}</option>`).join('');
const when=value=>value?new Date(value).toLocaleString():'Date not recorded';
const prose=value=>`<p class="dream-prose">${e(value||'Not recorded.')}</p>`;

export function createDreamReview({getState,command,beforeNavigation,api,applyState,reportError}) {
  const book=document.createElement('dialog'),sheet=document.createElement('dialog');
  book.id='dream-review';book.className='app-dialog dream-review';
  sheet.id='dream-sheet';sheet.className='app-dialog dream-sheet';
  document.body.append(book,sheet);
  let view=null,selectedId=null,returnFocus,busy=false,draft=null,dirty=false,timer,chain=Promise.resolve(),controller=null,accept=null,source=null,signature='';
  const state=()=>getState(),record=()=>view?.records.find(r=>r.id===selectedId);
  const activity=document.getElementById('work-controls');
  function placeActivity(){const target=sheet.open?sheet:book.open?book:document.getElementById('dialog').open?document.getElementById('dialog'):document.getElementById('activity-home');if(activity&&activity.parentElement!==target)target.append(activity);}
  const fail=err=>{const node=(sheet.open?sheet:book).querySelector('.dream-error');if(node){node.hidden=false;node.textContent=err.message;}else reportError(err.message);};
  const size=createSettingsSize({dialog:book,label:'Dream review',defaultWidth:970,defaultHeight:660,getPreference:()=>state()?.ui.dreamSize,save:dreamSize=>command('ui.update',{dreamSize},{renderNow:false}),onError:reportError});
  function queueDraft(){
    clearTimeout(timer);if(!dirty)return chain;
    const saved=structuredClone(draft);dirty=false;
    chain=chain.catch(()=>{}).then(()=>command('ui.update',{dreamDraft:saved},{renderNow:false})).catch(err=>{dirty=true;throw err;});
    return chain;
  }
  async function persist(){await queueDraft();await size.flush();}
  async function run(action){if(busy)return;busy=true;book.setAttribute('aria-busy','true');try{await action();}catch(err){fail(err);}finally{busy=false;book.removeAttribute('aria-busy');}}
  const payload=extra=>({personalId:view.personalId,baseRevision:view.revision,...extra});
  function key(){return JSON.stringify([state().dreamHistory,state().personalParticipants,state().models]);}
  async function reload(){view=await api.dreamView(view.personalId);signature=key();paint();}
  function showSheet(title,body){
    sheet.innerHTML=`<div class="dialog-header"><h2>${e(title)}</h2>${button('close-sheet','×','aria-label="Close detail window"','icon-button')}</div><div class="dialog-body">${body}<p class="dream-error" role="alert" hidden></p></div>`;
    sheet.setAttribute('aria-label',title);if(!sheet.open)sheet.showModal();placeActivity();sheet.querySelector('[autofocus]')?.focus();
  }
  function currentLabel(){const r=view.records.find(r=>r.generationId===view.currentGenerationId);return r?.topic || (view.currentGenerationId===view.startingGenerationId?'Starting point':'State not recorded in this journal');}
  function paint(){
    if(!book.open||!view)return;
    book.querySelector('h2').textContent='Review Dreams · '+view.name;
    const list=book.querySelector('.dream-journal-list'),scroll=list.scrollTop;
    list.innerHTML=button('select-origin','Starting point',`aria-pressed="${selectedId===null}"`,'dream-entry')+view.records.slice().reverse().map(r=>button('select',`<span>${e(r.topic||'Dream')}</span><small>${e(when(r.occurredAt))}</small><small>${e(DREAM_OUTCOMES[r.outcome])}${r.generationId===view.currentGenerationId?' · Current':''}</small>`,`data-id="${e(r.id)}" aria-pressed="${selectedId===r.id}"`,'dream-entry')).join('')+(view.records.length?'':'<p class="field-help dream-empty">No Dreams recorded yet. Your personal model is here; its history can grow from here.</p>');
    list.scrollTop=scroll;
    const r=record(),note=view.notes.findLast(n=>n.dreamId===r?.id),pending=draft??state().ui.dreamDraft;
    const editing=pending?.dreamId===r?.id,other=pending&&!editing;
    const content=book.querySelector('.dream-journal-detail');
    content.innerHTML=`<p class="dream-current"><span class="status-dot"></span> Current: ${e(currentLabel())}</p>${r?`
      <h3>${e(r.topic||'Dream')}</h3><p class="field-help">${e(when(r.occurredAt))} · ${e(DREAM_OUTCOMES[r.outcome])} · Recorded by you</p>
      <h4>What went into it</h4>${prose(r.summary)}
      <div class="dream-source-list">${r.sources.map((s,i)=>{const check=view.sources.find(c=>c.chatId===s.chatId&&c.messageId===s.messageId);return button('source',e(s.desk+' / '+s.title)+(check?.archived?' · Archived':'')+(!check?.available?' · Unavailable':''),`data-index="${i}" ${check?.available?'':'disabled'}`,'text-button');}).join('')||'<p class="field-help">No conversation source recorded.</p>'}</div>
      <h4>What happened</h4>${prose(r.observations)}
      <label class="form-field">Your note<textarea id="dream-note" rows="5" maxlength="64000" ${other?'disabled':''}>${e(editing?pending.text:note?.text||'')}</textarea></label>
      ${other?'<p class="notice">Another Dream has an unfinished note. Resume it before editing this one.</p>':''}
      <div class="dream-note-actions">${button('save-note','Save note',other?'disabled':'','primary-button')}${pending?button('resume-note','Resume unfinished note')+button('discard-note','Discard unfinished note','','text-button'):''}<small id="dream-note-status">${editing?'Unfinished note kept locally':note?'Saved '+e(when(note.at)):'Your note stays separate from the recorded account.'}</small></div>
      <details class="dream-technical"><summary>Technical details &amp; recovery</summary><dl><dt>Recorded in Branchline</dt><dd>${e(when(r.at))}</dd><dt>Evidence</dt><dd>User-declared account. No training run was observed by this app.</dd><dt>Saved connection</dt><dd>${e(r.modelSnapshot?.name||'None recorded')}</dd><dt>Model identifier</dt><dd>${e(r.modelSnapshot?.model||'Unknown')}</dd><dt>Saved state</dt><dd>${e(r.generationId||'Not recorded')}</dd><dt>Backup availability</dt><dd>${r.modelId?'A connection was recorded. Recovery checks its route and contents before selection.':'No saved model state is attached to this account.'}</dd></dl>${r.modelId?button('restore','Check recovery'):''}
      ${view.transitions.filter(t=>t.dreamId===r.id).map(t=>`<p class="field-help">Selected ${e(when(t.at))} · included files checked. Stock weights; no trained adapter reconstruction.</p>`).join('')}
      ${r.legacyPersonalId?`<p class="field-help">Original personal entry: ${e(state().personalParticipants.find(p=>p.id===r.legacyPersonalId)?.name||r.legacyPersonalId)}</p>${view.members.some(m=>m.memberId===r.legacyPersonalId)?button('unlink','Keep this earlier entry separate'): '<p class="field-help">This association was later removed. Its original record remains here.</p>'}`:''}</details>`:originMarkup()}`;
  }
  function originMarkup(){const o=view.origin;return `<h3>Starting point</h3><p>A personal model can keep its name as its connections and learned states change.</p><dl class="dream-origin"><dt>Starting model</dt><dd>${e(o.baseModel)}</dd><dt>Revision</dt><dd>${e(o.baseRevision||'Not recorded')}</dd><dt>Initial adapter</dt><dd>${e(o.adapterStatus==='none'?'Declared: no adapter':o.adapterStatus==='recorded'?o.adapterIdentifier:'Unknown / not recorded')}</dd>${o.adapterDigest?`<dt>Supplied adapter digest</dt><dd>${e(o.adapterDigest)} · not checked by this app</dd>`:''}<dt>Evidence</dt><dd>${e(o.evidence||'Not supplied')}</dd><dt>Recorded</dt><dd>${e(when(o.at))} · User-declared</dd><dt>Earlier start, if supplied</dt><dd>${e(when(o.claimedStartedAt))}</dd><dt>Issuer receipt</dt><dd>None linked. These local records are available without a stamp.</dd></dl>${button('edit-origin','Add or correct starting point')}<p class="field-help">Corrections add a new record. Earlier information remains in your local export.</p>${view.records.length?'':'<p class="notice">Dream training and scheduling are coming later. You can record an earlier Dream or organize model entries you already saved.</p>'}`;}
  async function open(id){
    await beforeNavigation();await persist();
    if(!id)throw new Error('Choose a personal model to review.');
    view=await api.dreamView(dreamOwner(state(),id));selectedId=null;signature=key();returnFocus=document.activeElement;
    draft=structuredClone(state().ui.dreamDraft??draft);
    if(draft?.personalId===view.personalId)selectedId=draft.dreamId;
    if(!book.open){book.innerHTML=`<div class="dialog-header"><h2>Review Dreams</h2>${button('close','×','data-action="close-dialog" aria-label="Close Dream review"','icon-button')}</div><div class="dream-review-tools">${button('new','Record a Dream')}${button('organize','Organize earlier entries')}${button('export','Export history')}${button('refresh','Refresh','','text-button')}</div><div class="dream-journal"><nav class="dream-journal-list" aria-label="Dream history"></nav><section class="dream-journal-detail" aria-label="Selected Dream"></section></div><p class="dream-error" role="alert" hidden></p>`;book.setAttribute('aria-label','Dream review');book.showModal();placeActivity();size.attach();}
    paint();
  }
  async function close(){await persist();size.detach();book.close();applyState(state());
    const parent=document.getElementById('dialog').open?document.getElementById('dialog'):document;
    const fallback=parent.querySelector(`[data-action="dream-review"][data-id="${CSS.escape(view.personalId)}"]`);
    (returnFocus?.isConnected?returnFocus:fallback)?.focus();
  }
  async function saveNote(){
    await persist();const r=record(),note=view.notes.findLast(n=>n.dreamId===r.id);
    const pending=draft??state().ui.dreamDraft;
    if(pending&&pending.dreamId!==r.id)throw new Error('Resume the unfinished note first.');
    await command('dream.note',payload({dreamId:r.id,text:pending?.text??book.querySelector('#dream-note').value,baseNoteId:pending?pending.baseNoteId:note?.id??null}),{renderNow:false});
    await command('ui.update',{dreamDraft:null},{renderNow:false});draft=null;dirty=false;await reload();
  }
  function newRecord(){
    const chats=state().chats.filter(c=>state().messages.some(m=>m.chatId===c.id));
    showSheet('Record an earlier Dream',`<p>Keep an account of a Dream prepared outside this app. Saving it preserves your account; it does not train or change your current model.</p><form id="dream-record-form"><label class="form-field">Short topic<input name="topic" maxlength="200" autofocus></label><label class="form-field">When it happened, if known<input type="datetime-local" name="occurredAt"></label><label class="form-field">What went into it<textarea name="summary" rows="3" maxlength="16000"></textarea></label><label class="form-field">What happened<textarea name="observations" rows="3" maxlength="16000"></textarea></label><label class="form-field">Outcome<select name="outcome">${options(Object.entries(DREAM_OUTCOMES),'unrecorded')}</select></label><label class="form-field">Saved local state, if available<select name="modelId">${options([['','No saved connection'],...state().models.filter(m=>m.runtime!=='codex').map(m=>[m.id,m.name])],'')}</select></label><label class="form-field">Conversation source, if relevant<select name="sourceId">${options([['','No conversation source'],...chats.map(c=>[c.id,(state().roots.find(r=>r.id===c.rootId)?.name||'Desk')+' / '+c.title+(c.archivedAt?' · Archived':'')])],'')}</select></label><p class="field-help">The source ends at its latest saved message when you opened this form. Later replies stay outside this account.</p><div class="dialog-footer">${button('close-sheet','Cancel')}<button class="primary-button" type="submit">Save account</button></div></form>`);
    sheet.querySelector('form')._cutoffs=Object.fromEntries(chats.map(c=>[c.id,state().messages.findLast(m=>m.chatId===c.id).id]));
  }
  function originEditor(){const o=view.origin;showSheet('Starting point',`<form id="dream-origin-form"><p>Record what you know. Unknown is a useful answer; earlier records will be retained.</p><label class="form-field">Starting base model<input name="baseModel" maxlength="500" required value="${e(o.baseModel)}" autofocus></label><label class="form-field">Base revision<input name="baseRevision" maxlength="200" value="${e(o.baseRevision)}"></label><label class="form-field">Initial adapter<select name="adapterStatus">${options([['unknown','Unknown / not recorded'],['none','No adapter (declared)'],['recorded','Adapter identifier supplied']],o.adapterStatus)}</select></label><label class="form-field">Adapter identifier, if supplied<input name="adapterIdentifier" maxlength="500" value="${e(o.adapterIdentifier)}"></label><label class="form-field">Supplied SHA-256, if known<input name="adapterDigest" maxlength="64" value="${e(o.adapterDigest||'')}"></label><label class="form-field">Evidence or source description<textarea name="evidence" maxlength="8000" rows="4">${e(o.evidence)}</textarea></label><label class="form-field">Earlier start date, if known<input name="claimedStartedAt" type="date" value="${e(o.claimedStartedAt?.slice(0,10)||'')}"></label><p class="field-help">Supplied information is labeled as declared. Recording a digest does not independently verify those bytes.</p><div class="dialog-footer">${button('close-sheet','Cancel')}<button type="submit" class="primary-button">Save starting point</button></div></form>`);}
  function organize(){const candidates=visiblePersonalModels(state()).filter(p=>p.id!==view.personalId);showSheet('Organize earlier entries',`<p>Choose earlier entries that you identify as part of <strong>${e(view.name)}</strong>. Similar names or base models alone do not establish a relationship.</p><p>Your current connection stays selected. Existing replies keep their original authors.</p><form id="dream-organize-form"><div class="dream-organize-list">${candidates.map(p=>`<label class="check-line"><input type="checkbox" name="members" value="${e(p.id)}"> ${e(personalLabel(p))}</label>`).join('')||'<p>No separate personal entries are available.</p>'}</div><label class="form-field">What connects these entries?<textarea name="evidence" required maxlength="8000" rows="3"></textarea></label><div class="dialog-footer">${button('close-sheet','Cancel')}<button type="submit" class="primary-button" ${candidates.length?'':'disabled'}>Preview organization</button></div></form>`);}
  async function ask(title,markup,action,label){accept=action;showSheet(title,markup+`<div class="dialog-footer">${button('close-sheet','Cancel','autofocus')}${button('confirm',label,'','primary-button')}</div>`);}
  async function recovery(){
    await persist();const input=payload({dreamId:record().id}),p=await api.dreamRestorePreview(input);
    const body=`<p>Personal model: <strong>${e(p.name)}</strong></p><p>Current: ${e(currentLabel())}<br>Saved connection: ${e(p.model)}</p><p>${e(p.limitation)}</p><p>Future Personal replies in ${p.affected.length} branch(es) will use this state: ${e(p.affected.join(', ')||'none currently assigned')}.</p><p>Conversation history, later Dreams, notes, Coats and permissions stay in place.</p>`;
    if(!p.supported)return showSheet('Recovery unavailable',body+`<p class="notice">No supported recovery route is available. Your current model is unchanged.</p>${button('close-sheet','Done')}`);
    await ask('Restore saved state',body,async()=>{
      controller=new AbortController();sheet.querySelector('.dialog-body').innerHTML=`<p role="status">Checking the included files and preparing the local connection…</p>${button('cancel-restore','Cancel recovery')}<p class="dream-error" role="alert" hidden></p>`;
      try{const next=await api.dreamRestore(input,controller.signal);applyState(next);sheet.close();await reload();}
      catch(err){if(controller.signal.aborted){await reload();showSheet('Recovery cancelled','<p>Refresh the journal to confirm its latest state. A selection already saved before cancellation remains recorded.</p>'+button('close-sheet','Done'));}else throw err;}
      finally{controller=null;}
    },'Restore this state');
  }
  async function readSource(index,offset=0){
    const result=await api.dreamSource({id:view.personalId,dreamId:record().id,index,offset});source={index,offset:result.nextOffset};
    const rows=result.messages.map(m=>`<article><strong>${e(m.role==='assistant'?m.name||'Model':m.role==='user'?'You':m.role)}</strong><small> · ${e(when(m.at))}</small><pre>${e(m.text)}</pre>${m.truncated?'<p class="notice">This long message is shortened in the reader. Its full text remains in the original conversation and workspace export.</p>':''}</article>`).join('');
    if(offset===0)showSheet('Conversation source',`<p>${e(result.desk+' / '+result.title)}</p><p class="field-help">Recorded source through its saved cutoff. Opening it does not add it to a model’s context.</p><div class="dream-source-text">${rows}</div><div class="dialog-footer">${button('source-more','Read next messages',source.offset===null?'hidden':'')}${button('close-sheet','Close')}</div>`);
    else {sheet.querySelector('.dream-source-text').insertAdjacentHTML('beforeend',rows);sheet.querySelector('[data-dream-action="source-more"]').hidden=source.offset===null;}
  }
  async function action(name,node){
    if(name==='close')return close();if(name==='close-sheet'){sheet.close();return;}
    if(name==='select'||name==='select-origin'){await persist();selectedId=name==='select'?node.dataset.id:null;paint();return;}
    if(name==='refresh'){await persist();return reload();}
    if(name==='new')return newRecord();if(name==='organize')return organize();if(name==='edit-origin')return originEditor();
    if(name==='save-note')return saveNote();
    if(name==='resume-note'){await persist();const pending=draft??state().ui.dreamDraft;view=await api.dreamView(pending.personalId);selectedId=pending.dreamId;paint();return;}
    if(name==='discard-note')return ask('Discard unfinished note','<p>The last saved note will remain.</p>',async()=>{clearTimeout(timer);await queueDraft();await command('ui.update',{dreamDraft:null},{renderNow:false});draft=null;dirty=false;sheet.close();paint();},'Discard draft');
    if(name==='export'){await persist();return downloadExport('/api/dreams/export?'+new URLSearchParams({id:view.personalId}),'dream-history.json');}
    if(name==='source')return readSource(Number(node.dataset.index));if(name==='source-more')return readSource(source.index,source.offset);
    if(name==='restore')return recovery();
    if(name==='unlink'){const input=payload({memberId:record().legacyPersonalId,evidence:'User chose to keep the earlier entry separate in Dream review.'});return ask('Keep earlier entry separate','<p>The original personal model becomes visible again. Branches still using the organization’s assignment return to that entry. Later chair choices and every reply remain unchanged.</p>',async()=>{await command('dream.unlink',input,{renderNow:false});sheet.close();await reload();},'Keep separate');}
    if(name==='confirm'){const fn=accept;accept=null;if(fn)await fn();}
  }
  for(const d of [book,sheet]){
    d.addEventListener('click',event=>{const node=event.target.closest('[data-dream-action]');if(!node)return;event.preventDefault();event.stopPropagation();if(node.dataset.dreamAction==='cancel-restore'){controller?.abort();return;}void run(()=>action(node.dataset.dreamAction,node));});
    d.addEventListener('cancel',event=>{event.preventDefault();if(controller){controller.abort();return;}void run(()=>d===book?close():d.close());});
    d.addEventListener('close',placeActivity);
  }
  book.addEventListener('input',event=>{if(event.target.id!=='dream-note')return;const r=record(),note=view.notes.findLast(n=>n.dreamId===r.id);draft={personalId:view.personalId,dreamId:r.id,baseNoteId:draft?.dreamId===r.id?draft.baseNoteId:note?.id??null,text:event.target.value};dirty=true;book.querySelector('#dream-note-status').textContent='Unfinished note · saving locally…';clearTimeout(timer);timer=setTimeout(()=>queueDraft().then(()=>{const n=book.querySelector('#dream-note-status');if(n)n.textContent='Unfinished note kept locally';}).catch(fail),350);});
  sheet.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();const form=event.target,data=new FormData(form);void run(async()=>{
    if(form.id==='dream-record-form'){
      const chatId=data.get('sourceId');await command('dream.record',payload({topic:data.get('topic'),occurredAt:data.get('occurredAt')?new Date(data.get('occurredAt')).toISOString():null,summary:data.get('summary'),observations:data.get('observations'),outcome:data.get('outcome'),modelId:data.get('modelId')||null,sources:chatId?[{chatId,messageId:form._cutoffs[chatId]}]:[]}),{renderNow:false});
      selectedId=state().dreamHistory.records.at(-1).id;sheet.close();await reload();
    }else if(form.id==='dream-origin-form'){
      const origin=Object.fromEntries(data);origin.adapterDigest=origin.adapterDigest||null;origin.claimedStartedAt=origin.claimedStartedAt?new Date(origin.claimedStartedAt).toISOString():null;
      if(origin.adapterStatus!=='recorded'){origin.adapterIdentifier='';origin.adapterDigest=null;}
      await command('dream.origin',payload({origin}),{renderNow:false});sheet.close();await reload();
    }else if(form.id==='dream-organize-form'){
      const input=payload({members:data.getAll('members'),evidence:data.get('evidence')}),p=await api.dreamOrganizePreview(input);
      const body=`<p>Keep <strong>${e(view.name)}</strong> with its current connection: ${e(p.currentModel)}.</p><p>Earlier entries: ${e(p.members.map(m=>m.name).join(', '))}.</p><p>Future Personal chairs in ${p.affected.length} branch(es): ${e(p.affected.map(c=>c.title).join(', ')||'none')}.</p><p>History and the effective Coats remain. No conversation from another desk is sent anywhere by organizing these entries.</p>`;
      if(p.conflicts.length)showSheet('Organization needs a choice',body+prose(p.conflicts.join('\n'))+button('organize','Back')+button('close-sheet','Cancel'));
      else await ask('Confirm organization',body,async()=>{await command('dream.organize',input,{renderNow:false});sheet.close();await reload();},'Organize entries');
    }
  });});
  return {open,persist,get busy(){return busy;},get unsaved(){return dirty;},get isOpen(){return book.open;},refresh(){if(book.open&&!sheet.open&&!busy&&view&&signature!==key())void run(()=>reload());}};
}
