import {api} from './api.js';
import {escapeHtml as e} from './views.js';
import {downloadExport} from './session.js';
import {chairRoster} from './chair-roster.js';
export function createPersonalContext({getState,refresh,openDialog,toast}){
  let chatId=null,library=null,profile=null,detail=null,files=[],draft=null,busy=false,sourceKind='reference',returnToBook=null;
  const op=()=>crypto.randomUUID();
  const request=(route,input)=>api.personalContext(route,input);
  const activeChat=()=>getState().chats.find(c=>c.id===chatId);
  let memoryDraft=null;
  async function saveMemory(messageId){
    const m=getState().messages.find(m=>m.id===messageId);if(!m)throw new Error('Choose a saved response.');
    const selection=window.getSelection(),node=selection?.anchorNode?.parentElement;
    const selected=node?.closest('[data-message-id]')?.dataset.messageId===messageId?selection.toString():'';
    chatId=m.chatId;returnToBook=null;memoryDraft={messageId,chatId,note:selected||m.content,operation:op()};
    library=await request('');let last;try{last=localStorage.getItem('branchline-last-memory-profile');}catch{}
    await memoryEditor(library.profiles.find(p=>p.id===last)?.id??library.profiles[0]?.id??'');
  }
  async function memoryEditor(id){
    profile=id;detail=id?await request('/profile?'+new URLSearchParams({id})):null;
    show(`<form id="personal-context-remember"><label class="form-field">Save in<select id="memory-destination" name="profile">${library.profiles.map(p=>`<option value="${e(p.id)}" ${p.id===id?'selected':''}>${e(p.name)}</option>`).join('')}<option value="" ${!id?'selected':''}>New memory profile</option></select></label>
      ${!id?'<label class="form-field">Profile name<input name="newName" required maxlength="120" value="My memory"></label>':''}
      <label class="form-field">Memory<textarea name="note" rows="8" required maxlength="8000">${e(memoryDraft.note)}</textarea></label>
      <p class="field-help">Edit or shorten this passage. Its original message and author stay linked. ${detail?`${[...detail.current.content.orientation,...detail.current.content.account].length} of 8,000 characters already used. This adds to the current account for its selected recipients.`:'This saves locally; choose its model recipients later.'}</p>
      <button class="primary-button" type="submit">Save memory</button></form>`);
  }
  function remember(){const form=document.getElementById('personal-context-new');if(form)draft={...draft,name:form.elements.name.value,orientation:form.elements.orientation.value,account:form.elements.account.value,operation:draft?.operation??op()};}
  function setBusy(value){busy=value;const controls=document.getElementById('personal-context-controls');if(controls)controls.disabled=value;}
  function show(content){openDialog('Personal continuity',`<div class="personal-context-panel"><fieldset id="personal-context-controls" class="personal-context-controls" ${busy?'disabled':''}>${content}</fieldset><p id="personal-context-error" class="message-error" role="alert" hidden></p></div>`,'settings-dialog');}
  async function home(){remember();library=await request('');
    show(`<p>A shared place for the history you choose to carry. Each model keeps its own identity and trained generations.</p>${!library.available?'<p class="notice">This candidate needs its first-party continuity runtime configured before creating or reading a profile.</p>':''}
      <div class="harness-actions"><button type="button" class="primary-button" data-action="personal-context-new" ${!library.available?'disabled':''}>New personal profile</button><label class="quiet-button">Import profile<input type="file" id="personal-context-import" accept=".json" hidden></label></div>
      ${library.profiles.map(p=>`<p><button type="button" class="quiet-button" data-action="personal-context-open" data-id="${e(p.id)}">${e(p.name)}</button></p>`).join('')||'<p class="muted">No personal profiles yet. You can create one without a trained local model.</p>'}
      ${draft?'<button class="text-button" data-action="personal-context-new">Resume profile draft</button>':''}`);
  }
  function newProfile(){draft??={name:'',orientation:'',account:'',operation:op()};show(`<form id="personal-context-new"><label class="form-field">Name<input name="name" required maxlength="120" ${draft.edit?'readonly':''} value="${e(draft.name)}"></label>
    <label class="form-field">Orientation<textarea name="orientation" rows="5" maxlength="8000" placeholder="How would you like this familiar voice to meet you?">${e(draft.orientation)}</textarea></label>
    <label class="form-field">Current account<textarea name="account" rows="5" maxlength="8000" placeholder="What matters, what changed, and what remains open">${e(draft.account)}</textarea></label>
    <p class="field-help">Orientation and account share 8,000 characters. Source text stays behind readable handles.</p>
    <label class="form-field">Kind of attached source<select id="personal-context-source-kind">${[['reference','Reference text'],['fiction','Story or fiction'],['interpretation','An interpretation']].map(([value,label])=>`<option value="${value}" ${sourceKind===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <label class="form-field">Selected text sources<input id="personal-context-files" type="file" multiple accept=".md,.txt"></label><div id="personal-context-file-list">${files.map((f,i)=>`<p>${e(f.title)} <button type="button" class="text-button" data-action="personal-context-remove-file" data-index="${i}">Remove</button></p>`).join('')||'No source files selected.'}</div>
    ${activeChat()?'<label class="form-field">Add an exact message from this conversation<select id="personal-context-message"><option value="">Choose a message</option>'+getState().messages.filter(m=>m.chatId===chatId).map((m,i)=>`<option value="M${i+1}">M${i+1} · ${e(m.role)} · ${e(m.content.slice(0,65))}</option>`).join('')+'</select></label><button type="button" class="quiet-button" data-action="personal-context-add-message">Add selected message</button>':''}
    <p class="field-help">${draft.edit?'Keeping this revision updates the profile for its already-cleared model destinations on their next reply. Existing replies retain their own revision.':'Creating saves this reviewed text. It does not attach it to a chair or send it to a model.'}</p>
    <p class="field-help">An unfinished profile draft stays available while this window is open.</p>${returnToBook?'<button type="button" class="text-button" data-action="personal-context-book-return">Back to Book</button>':''}<div class="dialog-footer"><button type="button" class="quiet-button" data-action="personal-context-home">Keep draft</button><button type="submit" class="primary-button">${draft.edit?'Keep reviewed profile':'Create profile'}</button></div></form>`);}
  async function view(id=profile){profile=id;detail=await request('/profile?'+new URLSearchParams({id}));
    const r=detail.current;if(!r)throw new Error('Profile has no reviewed account.');const data=r.content;
    const s=getState(),chat=activeChat(),roster=chat?chairRoster(s,chat):null,visitor=roster?.visitors.find(c=>c.id===roster.selectedVisitorId);
    const seatReady={personal:!!roster?.desk.modelId,visiting:!!visitor?.modelId};
    const modelIds=new Set([roster?.desk.modelId,visitor?.modelId].filter(Boolean));
    const currentBindings=library?.bindings?.filter(b=>b.chatId===chatId&&b.profileId===profile)??[];
    show(`<h3>${e(data.name)}</h3><p class="field-help">${e(r.author.kind==='automatic_policy'?'Saved automatically by '+r.author.model:r.author.kind==='external_file'?'Memory file changed since last read · author unknown':'Kept by local review')} · ${e(new Date(r.at).toLocaleString())}</p>
      <form id="personal-context-memory-mode"><label class="form-field">Memory saving<select name="mode">${['manual','suggest','automatic'].map(mode=>`<option value="${mode}" ${detail.memory.policy.mode===mode?'selected':''}>${mode[0].toUpperCase()+mode.slice(1)}</option>`).join('')}</select></label><p class="field-help">Manual: you save. Suggest: review model proposals. Automatic: permit model saves in this profile through its continuity pocket. Recipients and other permissions stay as selected.</p><button class="quiet-button" type="submit">Set mode</button></form>
      <details><summary>MEMORY.md</summary><p class="file-path">${e(detail.memory.path)}</p><button class="quiet-button" data-action="personal-context-open-file">Open file</button><p class="field-help">Outside edits are checked on opening and before use. Current memory stays within the shared 8,000-character limit. History stays separate.</p></details>
      <details open><summary>Orientation</summary><div class="harness-text">${e(data.orientation||'No extra orientation.')}</div></details>
      <details open><summary>Current account</summary><div class="harness-text">${e(data.account||'No account yet.')}</div></details>
      <details><summary>Selected sources · ${data.sources.length}</summary>${data.sources.map(src=>`<p><button class="text-button" data-action="personal-context-source" data-id="${e(src.id)}">${e(src.title)}</button> · ${e(src.kind)}</p>`).join('')||'<p>No sources selected.</p>'}</details>
      ${chat?`<form id="personal-context-bind"><h3>Use in ${e(chat.title)}</h3><p>Choose chairs and the exact model destinations allowed to receive this profile and replies derived from it.</p>
        ${['personal','visiting'].map(seat=>`<label class="check-line"><input type="checkbox" name="seat" value="${seat}" ${seatReady[seat]?'checked':'disabled'}>${seat==='personal'?'Desk Model':'Selected visitor'}</label>`).join('')}
        ${s.models.map(m=>`<label class="check-line"><input type="checkbox" name="model" value="${e(m.id)}" ${modelIds.has(m.id)?'checked':''}>${e(m.name)} · ${e(m.model)} <small>${e(m.baseUrl)}</small></label>`).join('')}
        <details><summary>Source passages to include initially</summary><p class="field-help">Other sources remain available to reopen. Shorter input leaves more conversation space.</p>${data.sources.map(src=>`<label class="check-line"><input type="checkbox" name="source" value="${e(src.id)}" ${currentBindings.some(b=>b.sourceIds.includes(src.id))?'checked':''}>${e(src.title)}</label>`).join('')}</details>
        <p class="field-help">This follows the selected Coat in each chair. Editing that Coat keeps its profile connected. Choosing another Coat or taking it off pauses its profile. Reading sources or proposing notes through tools also needs the corresponding Coat pockets and Tools switch.</p>
        <div class="dialog-footer"><button type="button" class="quiet-button" data-action="personal-context-detach">Detach from this conversation</button><button type="submit" class="primary-button">Review and use here</button></div></form>`:'<p>Open a conversation to attach this profile to its chairs.</p>'}
      <p><button class="quiet-button" data-action="personal-context-edit">Edit orientation and sources</button></p>
      <form id="personal-context-propose" data-operation="${op()}"><h3>Revise the account</h3><label class="form-field">Proposed account<textarea name="account" rows="5" maxlength="8000">${e(data.account)}</textarea></label><button type="submit" class="quiet-button">Save proposal for review</button></form>
      <h3>Proposals</h3>${detail.proposals.filter(p=>p.decision==='pending').map(p=>`<section><p>From ${e(p.author.kind==='model'?(p.author.model||'model')+' · '+(p.author.chair||'chair'):'your local review')} · ${e(new Date(p.at).toLocaleString())}</p><div class="harness-text">${e(p.account)}</div><button class="quiet-button" data-action="personal-context-review" data-id="${e(p.operation)}">Review proposal</button></section>`).join('')||'<p class="muted">No pending proposals.</p>'}
      <details id="memory-history"><summary>History · ${detail.revisions.length}</summary>${detail.revisions.map(v=>`<p>${e(new Date(v.at).toLocaleString())} · ${e(v.author.kind==='external_file'?'External edit · author unknown':v.author.kind==='automatic_policy'?'Automatic · '+v.author.model:'Local review')} · ${e(v.event)}</p><div class="harness-text">${e(v.content.account)}</div>`).join('')}</details>
      ${r.previous?`<button class="quiet-button" data-action="personal-context-undo" data-id="${e(r.operation)}">Undo latest memory change</button>`:''}
      <details><summary>Proposal history</summary>${detail.proposals.filter(p=>p.decision!=='pending').map(p=>`<p>${e(p.decision)} · ${e(p.author.model||p.author.kind)}</p><div class="harness-text">${e(p.account)}</div>`).join('')||'<p>No earlier proposals.</p>'}</details>
      ${detail.events.some(v=>v.importedHistory)?`<details><summary>Imported history and original attribution</summary>${detail.events.flatMap(v=>v.importedHistory??[]).map(v=>`<p>${e(v.event)} · ${e(v.author?.model||v.author?.kind||'Unknown origin')}</p><div class="harness-text">${e(v.content?.account??v.account??'')}</div>`).join('')}</details>`:''}
      <div class="dialog-footer"><button class="quiet-button" data-action="personal-context-home">All profiles</button><button class="quiet-button" data-action="personal-context-export">Export selected history</button></div>`);
  }
  async function action(action,target){if(!action.startsWith('personal-context-'))return false;if(busy)return true;
    setBusy(true);try{
      if(action==='personal-context-book-return'){remember();const back=returnToBook;returnToBook=null;await back?.(null);}
      else if(action==='personal-context-home')await home();
      else if(action==='personal-context-new')newProfile();
      else if(action==='personal-context-remove-file'){remember();files.splice(Number(target.dataset.index),1);newProfile();}
      else if(action==='personal-context-open')await view(target.dataset.id);
      else if(action==='personal-context-open-file'){await request('/openMemory',{profile});}
      else if(action==='personal-context-undo'){await request('/undo',{profile,revision:target.dataset.id,operation:op()});await refresh();await view();toast('Memory restored as a new revision.');}
      else if(action==='personal-context-edit'){const c=detail.current.content;draft={name:c.name,orientation:c.orientation,account:c.account,operation:op(),edit:profile,baseRevision:detail.current.operation,expectedHead:detail.head};files=c.sources.map(s=>({title:s.title,origin:s.origin,kind:s.kind,text:s.text}));newProfile();}
      else if(action==='personal-context-add-message'){remember();const source=document.getElementById('personal-context-message').value;if(!source)throw new Error('Choose a message first.');files.push(await request('/chat-source?'+new URLSearchParams({chat:chatId,source})));newProfile();}
      else if(action==='personal-context-export')await downloadExport('/api/personal-context/export?'+new URLSearchParams({id:profile}),'personal-continuity.json');
      else if(action==='personal-context-source'){const source=await request('/source?'+new URLSearchParams({id:profile,source:target.dataset.id,offset:target.dataset.offset||0}));show(`<h3>${e(source.title)}</h3><p>${e(source.origin)} · ${e(source.kind)}</p><div class="harness-text">${e(source.text)}</div>${source.nextOffset!==null?`<button class="quiet-button" data-action="personal-context-source" data-id="${e(source.id)}" data-offset="${source.nextOffset}">Next passage</button>`:''}<button class="quiet-button" data-action="personal-context-open" data-id="${e(profile)}">Back to profile</button>`);}
      else if(action==='personal-context-detach'){await request('/bind',{chatId,profileId:null,seats:['personal','visiting'],modelIds:[],sourceIds:[]});await refresh();await home();toast('Profile detached. Saved history remains.');}
      else if(action==='personal-context-review'){const p=detail.proposals.find(p=>p.operation===target.dataset.id);show(`<form id="personal-context-review" data-id="${e(p.operation)}" data-operation="${op()}"><p>Review this proposal before keeping it. Earlier text and its actual author remain recorded.</p><label class="form-field">Account to keep<textarea name="account" rows="10" maxlength="8000">${e(p.account)}</textarea></label><div class="dialog-footer"><button type="submit" name="decision" value="reject" class="quiet-button">Reject proposal</button><button type="submit" name="decision" value="accept" class="primary-button">Keep this correction</button></div></form>`);}
    }finally{setBusy(false);}return true;}
  async function submit(event){const form=event.target;if(!form.id.startsWith('personal-context-'))return false;event.preventDefault();if(busy)return true;setBusy(true);
    try{
      if(form.id==='personal-context-remember'){
        memoryDraft.note=form.elements.note.value;
        if(!profile){const created=await request('/create',{operation:memoryDraft.operation,content:{name:form.elements.newName.value,orientation:'',account:'',sources:[]},bundle:null});profile=created.profile;detail=await request('/profile?'+new URLSearchParams({id:profile}));}
        const saved=await request('/remember',{profile,operation:'note_'+memoryDraft.operation,baseRevision:detail.current.operation,expectedHead:detail.head,...Object.fromEntries(['note','chatId','messageId'].map(k=>[k,memoryDraft[k]]))});
        try{localStorage.setItem('branchline-last-memory-profile',profile);}catch{}
        memoryDraft=null;await refresh();library=await request('');
        show(`<p role="status">Memory updated</p><button class="quiet-button" data-action="personal-context-open" data-id="${e(profile)}">View</button> <button class="quiet-button" data-action="personal-context-undo" data-id="${e(saved.operation)}">Undo</button>`);
      }
      else if(form.id==='personal-context-memory-mode'){await request('/memoryPolicy',{profile,mode:form.elements.mode.value});await refresh();await view();}
      else if(form.id==='personal-context-new'){remember();const content={name:draft.name,orientation:draft.orientation,account:draft.account,sources:files};let id;if(draft.edit){id=draft.edit;await request('/revise',{profile:id,operation:draft.operation,expectedHead:draft.expectedHead,baseRevision:draft.baseRevision,content});}else{id=(await request('/create',{operation:draft.operation,content,bundle:null})).profile;}draft=null;files=[];await refresh();library=await request('');if(returnToBook){const back=returnToBook;returnToBook=null;await back(id);}else await view(id);}
      else if(form.id==='personal-context-bind'){await request('/bind',{chatId,profileId:profile,seats:[...form.querySelectorAll('[name=seat]:checked')].map(x=>x.value),modelIds:[...form.querySelectorAll('[name=model]:checked')].map(x=>x.value),sourceIds:[...form.querySelectorAll('[name=source]:checked')].map(x=>x.value)});await refresh();library=await request('');toast('Shared continuity selected for the next reply.');await view();}
      else if(form.id==='personal-context-propose'){await request('/propose',{profile,operation:form.dataset.operation,baseRevision:detail.current.operation,account:form.elements.account.value,sourceIds:detail.current.content.sources.map(s=>s.id)});await view();}
      else if(form.id==='personal-context-review'){await request('/decide',{profile,action:event.submitter.value,operation:form.dataset.operation,proposal:form.dataset.id,expectedHead:detail.head,account:form.elements.account.value});await view();toast('Review saved. The next reply will use the current account.');}
    }catch(error){const notice=document.getElementById('personal-context-error');if(notice){notice.textContent=error.message;notice.hidden=false;}else throw error;}
    finally{setBusy(false);}return true;}
  async function change(event){
    if(event.target.id==='memory-destination'){memoryDraft.note=document.getElementById('personal-context-remember').elements.note.value;await memoryEditor(event.target.value);return true;}
    if(event.target.id==='personal-context-source-kind'){sourceKind=event.target.value;return true;}
    if(event.target.id==='personal-context-files'){if(busy)return true;remember();setBusy(true);try{const selected=[...event.target.files];if(selected.length+files.length>12)throw new Error('Choose up to twelve sources.');
      const added=[];for(const file of selected){if(file.size>65536)throw new Error('A source exceeds 64 KiB.');added.push({title:file.name,origin:'Explicitly selected local text snapshot',kind:sourceKind,text:new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())});}files.push(...added);newProfile();return true;}finally{setBusy(false);}}
    if(event.target.id==='personal-context-import'){const file=event.target.files[0];if(!file)return true;if(file.size>120000)throw new Error('This bundle is too large.');const bundle=JSON.parse(await file.text());
      show(`<form id="personal-context-import-confirm"><p>Import ${e(bundle.content?.name||'profile')} as a separate profile? Its history remains attributed as imported material. It will not attach to a chair.</p><h3>Orientation</h3><div class="harness-text">${e(bundle.content?.orientation||'')}</div><h3>Account</h3><div class="harness-text">${e(bundle.content?.account||'')}</div><h3>Sources</h3>${(bundle.content?.sources??[]).map(s=>`<details><summary>${e(s.title)} · ${e(s.kind)}</summary><div class="harness-text">${e(s.text)}</div></details>`).join('')}<button class="primary-button" type="button" id="personal-context-import-confirm-button">Import reviewed profile</button></form>`);
      const importOperation=op();document.getElementById('personal-context-import-confirm-button').onclick=async()=>{if(busy)return;setBusy(true);try{const made=await request('/create',{operation:importOperation,content:null,bundle});await refresh();library=await request('');await view(made.profile);}catch(error){document.getElementById('personal-context-error').textContent=error.message;document.getElementById('personal-context-error').hidden=false;}finally{setBusy(false);}};return true;}
    return false;
  }
  return {saveMemory,open:async id=>{returnToBook=null;chatId=id??null;await home();},newForBook:async(chat,back)=>{chatId=chat??null;returnToBook=back;library=await request('');newProfile();},openProfile:async(id,chat)=>{returnToBook=null;chatId=chat??null;library=await request('');await view(id);},action,submit,change,get busy(){return busy;}};
}
