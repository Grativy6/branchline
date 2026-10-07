import { SKETCH_STAGES, SKETCH_BYTES, sketchHead, sketchExcerpt, sketchDestination, sameSketchDestination, checkSketchContent } from './sketch-format.js';
import { createSettingsSize } from './settings-size.js';
import { escapeHtml as e } from './views.js';
import { downloadExport } from './session.js';

const uid = () => 'sketchui_' + crypto.randomUUID();
const button = (action,label,cls='quiet-button',extra='') => `<button type="button" class="${cls}" data-sketch-action="${action}" ${extra}>${label}</button>`;
const options = (values,value) => values.map(([id,label])=>`<option value="${e(id)}" ${id===value?'selected':''}>${e(label)}</option>`).join('');
export function createSketchBook({ getState, command, beforeNavigation, attachment, navigate, showCoats, api, toast, reportError }) {
  const book=document.createElement('dialog'),sheet=document.createElement('dialog'),confirm=document.createElement('dialog');
  book.id='sketch-book';sheet.id='sketch-sheet';confirm.id='sketch-confirm';
  book.className='app-dialog sketch-book';sheet.className='app-dialog sketch-sheet';confirm.className='app-dialog sketch-confirm';
  for(const dialog of [book,sheet,confirm])document.body.append(dialog);
  const activityControl=document.getElementById('work-controls');
  const placeActivity=()=>{const parent=confirm.open?confirm:sheet.open?sheet:book.open?book:document.getElementById('dialog').open?document.getElementById('dialog'):document.getElementById('activity-home');if(activityControl&&activityControl.parentElement!==parent)parent.append(activityControl);};
  for(const d of [book,sheet,confirm])d.addEventListener('close',placeActivity);
  let selectedId=null, archived=false, search='', draft=null, dirty=false, timer, chain=Promise.resolve(), busy=false, view='', returnFocus, rendered='', confirmAction;
  const state=()=>getState(), records=()=>state()?.sketchBook?.records??[];
  const selected=()=>records().find(s=>s.id===selectedId&&!s.deletedAt);
  const header=(title,action='close-sheet')=>`<div class="dialog-header"><h2>${e(title)}</h2>${button(action,'×','icon-button',`aria-label="Close ${e(title)}"`)}</div>`;
  const showSheet=(title,body,kind)=>{view=kind;sheet.innerHTML=header(title)+`<div class="dialog-body">${body}<p class="sketch-error" role="alert" hidden></p></div>`;sheet.setAttribute('aria-label',title);if(!sheet.open)sheet.showModal();placeActivity();sheet.querySelector('[autofocus]')?.focus();};
  const fail=error=>{const target=(sheet.open?sheet:book).querySelector('.sketch-error');if(target){target.hidden=false;target.textContent=error.message;}else reportError(error.message);};
  async function run(action){if(busy)return;busy=true;const controls=[...book.querySelectorAll('button,input,select,textarea'),...sheet.querySelectorAll('button,input,select,textarea')].filter(n=>!n.closest('#work-controls')).map(n=>[n,n.disabled]);for(const [n]of controls)n.disabled=true;try{await action();}catch(err){fail(err);}finally{busy=false;for(const [n,disabled]of controls)if(n.isConnected)n.disabled=disabled;}}
  function queueDraft(){
    clearTimeout(timer);if(!dirty)return chain;
    const captured=structuredClone(draft);dirty=false;
    const next=chain.catch(()=>{}).then(()=>command('ui.update',{sketchDraft:captured},{renderNow:false}));
    chain=next.catch(err=>{if(draft?.requestId===captured?.requestId)dirty=true;throw err;});
    return chain;
  }
  async function persist(){await queueDraft();await size.flush();}
  const size=createSettingsSize({dialog:book,label:'Sketch Book',defaultWidth:980,defaultHeight:610,getPreference:()=>state()?.ui.sketchSize,save:sketchSize=>command('ui.update',{sketchSize},{renderNow:false}),onError:reportError});
  function sourceText(s){return s?.origin?`Source: ${s.origin.desk} / ${s.origin.branch}`:'Created in Sketch Book';}
  function sources(s){const chat=state().chats.find(c=>c.id===s?.origin?.chatId),root=state().roots.find(r=>r.id===s?.origin?.rootId);return `<span>${e(sourceText(s))}${s?.origin?(!chat||!root?' · Source unavailable':chat.archivedAt||root.archivedAt?' · Archived source':''):''}</span>${chat&&root?button('source','Open source','text-button'):''}`;}
  function paint(force=false){
    if(!book.open)return;
    const all=records().filter(s=>!s.deletedAt&&!!s.archivedAt===archived).sort((a,b)=>sketchHead(b).at.localeCompare(sketchHead(a).at)||a.id.localeCompare(b.id));
    const items=all.filter(s=>(sketchHead(s).title+' '+sketchHead(s).text).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    if(!items.some(s=>s.id===selectedId))selectedId=items[0]?.id??null;
    const s=selected(),r=sketchHead(s),signature=JSON.stringify([items.map(s=>[s.id,sketchHead(s).id,s.archivedAt]),selectedId,archived,state().ui.sketchDraft?.requestId]);
    if(!force&&signature===rendered)return;rendered=signature;
    const scroll=[...book.querySelectorAll('.sketch-column-list')].map(n=>n.scrollTop);
    book.querySelector('.sketch-columns').innerHTML=Object.entries(SKETCH_STAGES).map(([stage,label])=>`<section class="sketch-column"><h3>${label}<small>${items.filter(s=>sketchHead(s).stage===stage).length}</small></h3><div class="sketch-column-list" aria-label="${label}">${items.filter(s=>sketchHead(s).stage===stage).map(s=>`<button type="button" class="sketch-item" data-sketch-action="select" data-id="${e(s.id)}" aria-pressed="${s.id===selectedId}"><strong>${e(sketchHead(s).title)}</strong><span>${e(sketchExcerpt(sketchHead(s).text)||'An open page.')}</span><small>${e(sourceText(s))}</small></button>`).join('')||'<p class="sketch-empty">'+(archived?'Nothing archived here.':stage==='ideas'?'A place for the first thought.':stage==='in-process'?'Give an idea some shape.':'Ready when you are.')+'</p>'}</div></section>`).join('');
    [...book.querySelectorAll('.sketch-column-list')].forEach((n,i)=>n.scrollTop=scroll[i]??0);
    book.querySelector('.sketch-bottom').innerHTML=`<div class="sketch-description">${r?`<strong>${e(r.title)}</strong><p>${e(sketchExcerpt(r.text)||'An open page.')}</p>`:'<strong>Your next idea can start here.</strong><p>Write a sketch, or save a model’s reply from a conversation.</p>'}</div><div class="sketch-actions">${button(archived?'restore':'edit',archived?'Restore sketch':'Edit sketch','quiet-button',s?'':'disabled')}${button('move','Use in conversation','quiet-button',s&&!archived?'':'disabled')}${button('delete','Delete','text-button',s?'':'disabled')}<div class="sketch-origin">${s?sources(s):''}<small>${r?e((r.author.kind==='model'?r.author.modelLabel:'You')+' · '+new Date(r.at).toLocaleString())+' · '+s.revisions.length+' saved version(s)':''}</small>${button('archives',archived?'Back to sketches':'Archives','text-button')}</div></div>`;
    book.querySelector('.sketch-heading').textContent=archived?'Sketch Book · Archives':'Sketch Book';
    book.querySelector('[data-sketch-action="resume"]').hidden=!state().ui.sketchDraft&&!draft;
  }
  async function open(id=null){
    await beforeNavigation();returnFocus=document.activeElement;
    if(id){selectedId=id;archived=!!records().find(s=>s.id===id)?.archivedAt;search='';}
    if(!book.open){
      book.innerHTML=`<div class="dialog-header"><h2 class="sketch-heading">Sketch Book</h2>${button('close-book','×','icon-button','aria-label="Close Sketch Book"')}</div><div class="sketch-top">${button('new','+ New sketch','primary-button')}${button('resume','Resume draft','quiet-button','hidden')}<label class="sketch-search"><span class="sr-only">Find a sketch</span><input type="search" placeholder="Find a sketch" aria-label="Find a sketch" value="${e(search)}"></label>${button('access','Model access','quiet-button')}</div><div class="sketch-columns"></div><p class="sketch-error" role="alert" hidden></p><footer class="sketch-bottom"></footer>`;
      book.setAttribute('aria-label','Sketch Book');book.showModal();placeActivity();size.attach();
    }
    paint(true);
  }
  async function closeBook(){await persist();size.detach();book.close();returnFocus?.isConnected&&returnFocus.focus();}
  function editor(requested=null){
    const unfinished=draft??state().ui.sketchDraft;
    const resumed=!!unfinished;
    draft=structuredClone(unfinished??requested??{id:null,baseRevisionId:null,originChatId:null,sourceMessageId:null,title:'',text:'',stage:'ideas',requestId:uid()});
    const saved=draft.id?records().find(s=>s.id===draft.id):null;
    const origin=saved?.origin??(draft.originChatId?{desk:state().roots.find(r=>r.id===state().chats.find(c=>c.id===draft.originChatId)?.rootId)?.name??'',branch:state().chats.find(c=>c.id===draft.originChatId)?.title??''}:null);
    showSheet(draft.id?'Edit sketch':'New sketch',`${resumed?'<p class="notice">Your unfinished sketch is here. Save or discard it before opening another editor.</p>':''}<form id="sketch-editor"><label class="form-field">Title<input name="title" maxlength="200" required autofocus value="${e(draft.title)}"></label><label class="form-field">Stage<select name="stage">${options(Object.entries(SKETCH_STAGES),draft.stage)}</select></label><label class="form-field sketch-text-label">Sketch<textarea name="text" rows="13" spellcheck="true">${e(draft.text)}</textarea></label><p class="field-help">${e(sourceText({origin}))} · <span id="sketch-byte-count"></span></p><p class="field-help">A schematic is ready to discuss or build from. Saving it does not start work.</p>${saved?`<details class="sketch-versions"><summary>Saved versions &amp; source</summary>${sources(saved)}${saved.sources.map(src=>`<p>${e(src.modelLabel)} · ${e(src.messageId)}${src.incomplete?' · Incomplete reply':''}</p>`).join('')}${saved.revisions.slice().reverse().map(r=>`<details><summary>${e(new Date(r.at).toLocaleString())} · ${e(r.author.kind==='model'?r.author.modelLabel:'You')} · ${e(SKETCH_STAGES[r.stage])}</summary><pre>${e(r.text)}</pre></details>`).join('')}</details>`:''}<div class="dialog-footer">${button('discard','Discard draft','text-button')}${saved?button('export','Export .md','quiet-button')+button('archive','Archive this sketch','quiet-button'):''}${button('close-sheet','Close','quiet-button')}<button type="submit" class="primary-button">Save sketch</button></div>${saved?button('save-copy','Save draft as a new sketch','text-button'):''}</form>`,'editor');
    dirty=true;count();timer=setTimeout(()=>queueDraft().catch(fail),350);
  }
  function count(){const node=sheet.querySelector('#sketch-byte-count');if(node)node.textContent=`${new TextEncoder().encode(draft.text).length.toLocaleString()} / ${SKETCH_BYTES.toLocaleString()} bytes · draft kept locally`;}
  async function save(asNew=false){
    checkSketchContent(draft);await persist();const payload=structuredClone(draft);
    if(asNew){payload.id=null;payload.baseRevisionId=null;payload.requestId=uid();payload.sourceMessageId=null;payload.originChatId=records().find(s=>s.id===draft.id)?.origin?.chatId??null;}
    await command('sketch.save',payload,{renderNow:false});
    selectedId=payload.id??records().find(s=>s.requestId===payload.requestId)?.id;archived=false;
    await command('ui.update',{sketchDraft:null},{renderNow:false});draft=null;dirty=false;sheet.close();paint(true);toast('Sketch saved');
  }
  function ask(title,description,action,label){
    confirmAction=action;confirm.innerHTML=header(title,'cancel-confirm')+`<div class="dialog-body"><p>${e(description)}</p><div class="dialog-footer">${button('cancel-confirm','Cancel','quiet-button','autofocus')}${button('accept-confirm',label,'primary-button')}</div></div>`;
    confirm.setAttribute('aria-label',title);confirm.showModal();placeActivity();confirm.querySelector('[autofocus]').focus();
  }
  async function move(){
    const s=selected();if(!s)return;await persist();
    const roots=state().roots.filter(r=>!r.archivedAt), current=state().ui.selected[state().ui.mode]?.rootId;
    showSheet('Use in conversation',`<p>Bring a saved copy of <strong>${e(sketchHead(s).title)}</strong> into a conversation. Its draft stays in place. You decide when to send.</p><form id="sketch-move"><label class="form-field">Desk<select name="rootId">${options(roots.map(r=>[r.id,r.name]),current)}</select></label><label class="form-field">Conversation<select name="chatId"></select></label><p class="field-help">The copy keeps this saved version, even if you edit the sketch later.</p><div class="dialog-footer">${button('close-sheet','Cancel')}<button type="submit" class="primary-button" ${roots.length?'':'disabled'}>Bring to conversation</button></div></form>`,'move');updateDestinations();
  }
  function updateDestinations(){const f=sheet.querySelector('#sketch-move');if(f)f.elements.chatId.innerHTML=options([['','New branch'],...state().chats.filter(c=>c.rootId===f.elements.rootId.value&&!c.archivedAt).map(c=>[c.id,c.title])],'');}
  async function access(){
    const {workspaceId}=await api.sketchAccess();
    showSheet('Model access',`<p>Let a saved model find sketches across every desk and branch in this workspace. Only the sketches are opened; their source conversations stay separate.</p><p class="field-help">A visiting provider receives the sketches it reads. Revoking access stops future book calls; material already in a conversation stays in its history and may inform shared desk memory.</p><div class="sketch-access-list">${state().models.map(m=>{const g=state().sketchBook?.grants.findLast(g=>g.workspaceId===workspaceId&&sameSketchDestination(g.destination,sketchDestination(m)));return `<form class="sketch-access" data-model="${e(m.id)}"><strong>${e(m.name)}</strong><small>${e(m.model)} · ${e(m.runtime==='codex'?'OpenAI':m.baseUrl)}</small><label class="form-field">Sketch Book access<select name="access">${options([['off','Off'],['read','Read sketches'],['edit','Read, create and edit sketches']],g?.access??'off')}</select></label><button class="quiet-button" type="submit">Save access</button><span class="field-help sketch-access-status" role="status"></span></form>`;}).join('')||'<p>Add a model in Settings to choose its access.</p>'}</div><p class="field-help">Also select “Read Sketch Book” and, if wanted, “Create/edit sketches” in its Coat pockets, then leave Tools on in the conversation. Turning on these pockets alone never grants access.</p><div class="dialog-footer">${button('coats','Coats &amp; pockets')}${button('close-sheet','Done','primary-button')}</div>`,'access');
    for(const f of sheet.querySelectorAll('.sketch-access'))f._destination=sketchDestination(state().models.find(m=>m.id===f.dataset.model));
  }
  async function source(){const s=view==='editor'?records().find(s=>s.id===draft?.id):selected();if(!s?.origin)return;await persist();const chat=state().chats.find(c=>c.id===s.origin.chatId),root=state().roots.find(r=>r.id===s.origin.rootId);if(chat?.archivedAt||root?.archivedAt)throw new Error('This source is archived. Restore its desk or branch from Home → View archives to open it. Your sketch is still here.');sheet.close();await closeBook();await navigate(s.origin.rootId,s.origin.chatId);}
  async function handle(action,target){
    if(action==='select'){selectedId=target.dataset.id;paint(true);return;}
    if(action==='close-book')return closeBook();
    if(action==='close-sheet'){await persist();sheet.close();paint(true);return;}
    if(action==='new'||action==='resume')return editor();
    if(action==='edit'){const s=selected(),r=sketchHead(s);if(s)return editor({id:s.id,baseRevisionId:r.id,originChatId:null,sourceMessageId:null,title:r.title,text:r.text,stage:r.stage,requestId:uid()});}
    if(action==='archives'){archived=!archived;paint(true);return;}
    if(action==='move')return move();
    if(action==='access')return access();
    if(action==='source')return source();
    if(action==='coats'){await persist();sheet.close();await closeBook();return showCoats();}
    if(action==='export'){const s=records().find(s=>s.id===draft.id),r=sketchHead(s);return downloadExport('/api/sketches/export?'+new URLSearchParams({id:s.id,revision:r.id}),'sketch-'+s.id+'.md');}
    if(action==='save-copy')return save(true);
    if(action==='discard')return ask('Discard this draft?','The last saved sketch stays unchanged. Only this unfinished editor text will be removed.',async()=>{await persist();await command('ui.update',{sketchDraft:null},{renderNow:false});draft=null;dirty=false;sheet.close();paint(true);},'Discard draft');
    if(action==='archive')return ask('Archive this sketch?','The saved version will move to Archives. Any unfinished changes will remain available as a draft.',async()=>{await persist();const s=records().find(s=>s.id===draft.id),r=sketchHead(s),changed=draft.title.trim()!==r.title||draft.text!==r.text||draft.stage!==r.stage;await command('sketch.archive',{id:s.id,baseRevisionId:draft.baseRevisionId},{renderNow:false});if(!changed){await command('ui.update',{sketchDraft:null},{renderNow:false});draft=null;dirty=false;}sheet.close();paint(true);},'Archive sketch');
    if(action==='restore'){const s=selected();await command('sketch.restore',{id:s.id,baseRevisionId:sketchHead(s).id},{renderNow:false});archived=false;paint(true);return;}
    if(action==='delete'){const s=selected(),baseRevisionId=sketchHead(s).id;return ask('Delete this sketch?',`“${sketchHead(s).title}” will leave the book and model tools. Copies already shared in conversations remain. Archive instead if you may want it back.`,async()=>{await command('sketch.delete',{id:s.id,baseRevisionId},{renderNow:false});paint(true);},'Delete sketch');}
    if(action==='cancel-confirm'){confirm.close();confirmAction=null;return;}
    if(action==='accept-confirm'){const action=confirmAction;confirm.close();confirmAction=null;await action?.();}
  }
  for(const d of [book,sheet,confirm]){
    d.addEventListener('click',event=>{const target=event.target.closest('[data-sketch-action]');if(!target)return;event.preventDefault();event.stopPropagation();void run(()=>handle(target.dataset.sketchAction,target));});
    d.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();void run(()=>handle(d===book?'close-book':d===sheet?'close-sheet':'cancel-confirm'));});
  }
  book.addEventListener('input',event=>{if(event.target.matches('.sketch-search input')){search=event.target.value;paint(true);}});
  sheet.addEventListener('input',event=>{if(view!=='editor'||!event.target.closest('#sketch-editor')||busy)return;const form=sheet.querySelector('form');draft={...draft,title:form.elements.title.value,text:form.elements.text.value,stage:form.elements.stage.value};dirty=true;count();clearTimeout(timer);timer=setTimeout(()=>queueDraft().catch(fail),350);});
  sheet.addEventListener('change',event=>{if(event.target.name==='rootId')updateDestinations();});
  sheet.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();void run(async()=>{
    const form=event.target;
    if(form.id==='sketch-editor')return save();
    if(form.classList.contains('sketch-access')){await command('sketch.grant',{modelId:form.dataset.model,destination:form._destination,access:form.elements.access.value},{renderNow:false});form.querySelector('.sketch-access-status').textContent='Saved for this connection';return;}
    if(form.id==='sketch-move'){
      const rootId=form.elements.rootId.value,chatId=form.elements.chatId.value||null;
      if(chatId&&attachment(chatId))throw new Error('That conversation already has attached text. Choose New branch, or remove or send its attachment first.');
      await beforeNavigation();const s=selected();const requestId=uid();await command('sketch.transfer',{id:s.id,baseRevisionId:sketchHead(s).id,rootId,chatId,requestId},{renderNow:false});
      const destination=state().sketchBook.transfers.find(t=>t.id===requestId).chatId;sheet.close();await closeBook();await navigate(rootId,destination);toast('Sketch attached · your message is still yours to send');
    }
  });});
  return {open,persist,async openAccess(){await open();await access();},refresh:()=>paint(),get busy(){return busy;},get unsaved(){return dirty;},get isOpen(){return book.open||sheet.open;},
    async saveReply(messageId){await open();const m=state().messages.find(m=>m.id===messageId&&m.role==='assistant');if(!m)throw new Error('That saved reply is unavailable.');editor({id:null,baseRevisionId:null,originChatId:m.chatId,sourceMessageId:m.id,title:sketchExcerpt(m.content).slice(0,80)||'Conversation sketch',text:m.content,stage:'ideas',requestId:uid()});}
  };
}
