import { reasoningNotesView } from './reasoning-notes.js';
import { noteSettings } from './reasoning-notes-settings.js';
import { api } from './api.js';
import { chairRoster } from './chair-roster.js';
import { routeChairPrompt, chairMention } from './chair-mentions.js';
import { renderMarkdown } from './markdown.js';
const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function routingFor(state,chat,text){const r=chairRoster(state,chat);return routeChairPrompt(text,r?[r.desk,...r.visitors]:[],r?.speaker==='visiting'?r.selectedVisitorId:r?.desk.id,r?.mode);}
export function createDeskWorkUI({getState,selection,sync,navigate,openDialog,reportError,toast}){
  let rows=[],sequence=-1,inFlight=false,currentOnly=false,lastRows='',closed=false,liveMarkup='',sharedMarkup='';
  const menu=document.querySelector('#work-controls .work-menu'),input=document.getElementById('message-input');
  const controls=menu.closest('details');
  function fitActivityMenu(){
    if(!controls.open)return;
    menu.style.transform='';
    const box=menu.getBoundingClientRect();
    const shift=Math.max(0,18-box.left)-Math.max(0,box.right-(window.innerWidth-18));
    if(shift)menu.style.transform=`translateX(${shift}px)`;
  }
  controls.addEventListener('toggle',fitActivityMenu);
  window.addEventListener('resize',fitActivityMenu);
  const activitySize=new ResizeObserver(fitActivityMenu);activitySize.observe(controls);
  const list=document.createElement('section');list.id='desk-activity-list';list.setAttribute('aria-label','Tasks across Branchline');menu.prepend(list);
  const queue=document.createElement('details');queue.id='crew-queued-inputs';queue.className='crew-queue';queue.hidden=true;queue.open=true;input.after(queue);let queueMarkup='';
  const preview=document.createElement('div');preview.id='chair-routing';preview.className='chair-routing';input.after(preview);
  const counter=document.createElement('small');counter.id='activity-count';document.querySelector('#work-controls summary').append(counter);
  const drawerButton=document.createElement('button');drawerButton.type='button';drawerButton.className='quiet-button';drawerButton.id='open-chair-drawers';drawerButton.textContent='Drawers';document.getElementById('context-status').after(drawerButton);
  const live=document.createElement('section');live.id='chair-live-tasks';live.setAttribute('aria-label','Chair tasks');
  const shared=document.createElement('section');shared.id='desk-shared-work';shared.setAttribute('aria-label','Shared desk work');
  function rowMarkup(row){return `<article class="activity-task ${row.active?'':'is-finished'}" data-task="${esc(row.id)}"><div><strong>${esc(row.chair??row.title)}</strong><span class="activity-status">${esc(row.phase??row.status)}</span></div><p>${esc(row.title)}</p><small>${esc(row.desk)}${row.branch?' / '+esc(row.branch):''}${row.model?' · '+esc(row.model):''}</small>${row.phase==='Waiting for local runtime slot'?'<p class="field-help">The local slot is in use. Other ready connections can continue.</p>':''}${row.error?`<p class="message-error">${esc(row.error)}</p>`:''}<div class="activity-task-actions">${row.chatId?`<button type="button" class="text-button" data-desk-action="open" data-task="${esc(row.id)}">Open task</button>`:''}<button type="button" class="text-button" data-desk-action="log" data-task="${esc(row.id)}">Inspect log</button>${row.active?`<button type="button" class="quiet-button" data-desk-action="stop" data-task="${esc(row.id)}">Stop</button>`:''}</div></article>`;}
  function renderActivity(){
    const active=rows.filter(r=>r.active),waiting=active.filter(r=>['waiting','queued'].includes(r.status)),preparing=active.filter(r=>r.status==='preparing'),stopping=active.filter(r=>r.status==='stopping'),running=active.length-waiting.length-preparing.length-stopping.length;
    counter.textContent=active.length?` · ${running} running${preparing.length?' · '+preparing.length+' preparing':''}${waiting.length?' · '+waiting.length+' waiting':''}${stopping.length?' · '+stopping.length+' stopping':''}`:'';
    const chat=selection().chat,visible=currentOnly?rows.filter(r=>r.chatId===chat?.id):rows;
    list.innerHTML=`<header><strong>Tasks</strong><label><input type="checkbox" data-desk-filter ${currentOnly?'checked':''}> This desk</label></header><p class="field-help">${currentOnly?'Current desk':'All desks'} · this Branchline app</p><div class="activity-current">${visible.filter(r=>r.active).map(rowMarkup).join('')||'<p class="muted">No tasks running.</p>'}</div>${visible.some(r=>!r.active)?`<details class="activity-recent"><summary>Recent results</summary>${visible.filter(r=>!r.active).map(rowMarkup).join('')}</details>`:''}`;
    if(controls.open)requestAnimationFrame(fitActivityMenu);
  }
  function renderComposer(){
    const state=getState(),chat=selection().chat;if(!state||!chat){preview.hidden=true;drawerButton.hidden=true;return;}
    drawerButton.hidden=false;const parsed=routingFor(state,chat,input.value),roster=chairRoster(state,chat);
    const start=input.selectionStart??input.value.length,before=input.value.slice(0,start),partial=/(?:^|\s)@([^\s@{}]*)$/.exec(before);
    const suggestions=partial?[roster.desk,...roster.visitors].filter(c=>c.name.toLocaleLowerCase().includes(partial[1].toLocaleLowerCase())).slice(0,8):[];
    const showRoutes=parsed.routed&&(!parsed.broadcast||parsed.errors.length>0);
    preview.hidden=!showRoutes&&!suggestions.length;
    preview.innerHTML=(suggestions.length?`<div class="chair-suggestions" aria-label="Choose a recipient">${suggestions.map(c=>`<button type="button" class="quiet-button" data-desk-action="mention" data-chair="${esc(c.id)}">${esc(chairMention(c.name))}</button>`).join('')}</div>`:'')+(showRoutes?`<div class="chair-routes" aria-label="Message routing">${parsed.sharedContext?`<small>Shared context: ${esc(parsed.sharedContext.slice(0,180))}</small>`:''}${parsed.sections.map(s=>`<div class="chair-route"><strong>${esc(s.label)}</strong><span>${esc(s.content.slice(0,180)||(parsed.sharedContext?'Receives the shared prompt':'Uses this chair’s Coat and desk context'))}</span></div>`).join('')}${parsed.errors.length?`<p class="message-error">${esc(parsed.errors.join(' '))}</p>`:'<small>One Send starts these addressed tasks together when their resources are ready.</small>'}</div>`:'');
  }
  function renderConversation(){
    const state=getState(),chat=selection().chat,container=document.getElementById('conversation');
    if(!state||!chat){live.remove();shared.remove();return;}
    const queued=rows.filter(r=>r.type==='chair'&&r.chatId===chat.id&&r.active&&!r.startedAt&&!r.automatic&&!r.originTaskId&&!r.scheduled);
    queue.hidden=!queued.length;const nextQueue=`<summary>Queued messages · ${queued.length}</summary><div>${queued.map(r=>`<article><strong>${esc(r.chair)}</strong> <small>${esc(r.delivery?.state==='requested'?'Steering requested':r.delivery?.state==='uncertain'?'Delivery uncertain':r.delivery?.reason??r.phase)}</small><p>${esc(r.content.slice(0,500))}</p><div>${!r.delivery||['queued','held'].includes(r.delivery.state)?`<button type="button" class="text-button" data-crew-action="edit" data-id="${esc(r.sourceId)}">Edit</button> ${r.delivery?.state==='held'?`<button type="button" class="quiet-button" data-crew-action="release" data-id="${esc(r.sourceId)}">Send queued</button>`:''}${r.canSteer&&state.ui.busyInputMode!=='queue-only'&&r.delivery?.state!=='held'?`<button type="button" class="quiet-button" data-crew-action="steer" data-id="${esc(r.sourceId)}">Steer now</button>`:''}`:''} <button type="button" class="text-button" data-crew-action="remove" data-id="${esc(r.sourceId)}" ${r.delivery?.state==='requested'?'disabled':''}>Remove pending</button></div></article>`).join('')}</div>`;if(nextQueue!==queueMarkup){queue.innerHTML=nextQueue;queueMarkup=nextQueue;}
    const pending=rows.filter(r=>r.type==='chair'&&r.chatId===chat.id&&r.active&&!state.messages.some(m=>m.role==='assistant'&&m.exchangeId===r.exchangeId));
    const nextLive=pending.map(r=>`<article class="message assistant chair-live" data-task="${esc(r.id)}"><div class="message-meta"><strong>${esc(r.chair)}</strong><span>${esc(r.phase)}</span><button class="text-button" type="button" data-desk-action="stop" data-task="${esc(r.id)}">Stop</button></div><div class="message-body markdown-body">${renderMarkdown(r.liveText||r.phase||'Queued')}</div>${noteSettings(chat).enabled?reasoningNotesView(state,{taskId:r.sourceId,live:true,status:r.notesStatus}):''}</article>`).join('');
    if(nextLive!==liveMarkup){const opened=new Set([...live.querySelectorAll('[data-note-panel][open]')].map(el=>el.dataset.notePanel));live.innerHTML=nextLive;liveMarkup=nextLive;for(const el of live.querySelectorAll('[data-note-panel]'))if(opened.has(el.dataset.notePanel))el.open=true;}
    const artifacts=(state.deskWork?.artifacts??[]).filter(a=>a.chatId===chat.id);
    const events=(state.deskWork?.events??[]).filter(e=>e.chatId===chat.id&&e.visibility!=='drawer'&&!['task.assigned','artifact.published'].includes(e.kind)).slice(-12);
    const nextShared=artifacts.map(a=>{const r=a.revisions.at(-1);return `<article class="desk-artifact"><div class="message-meta"><strong>${esc(r.title)}</strong><span>Shared by ${esc(r.author)}</span><button type="button" class="text-button" data-desk-action="drawer" data-chair="${esc(r.chairId)}">Source work log</button></div><div class="markdown-body">${renderMarkdown(r.text)}</div></article>`;}).join('')+(events.length?`<details class="desk-events"><summary>Desk activity · ${events.length} recent records</summary>${events.map(e=>`<p><strong>${esc(e.author.chair)}</strong> · ${esc(e.kind.replaceAll('.',' '))}${e.detail.tool?' · '+esc(e.detail.tool):''}${e.detail.status?' · '+esc(e.detail.status):''}${e.detail.message?'<br>'+esc(e.detail.message):''}${e.detail.sourceChairId?' · reading another chair’s log':''}</p>`).join('')}</details>`:'');
    if(nextShared!==sharedMarkup){shared.innerHTML=nextShared;sharedMarkup=nextShared;}
    if(nextShared){if(shared.parentNode!==container)container.insertBefore(shared,live.parentNode===container?live:null);}else shared.remove();
    if(pending.length){if(live.parentNode!==container)container.append(live);}else live.remove();
  }
  async function drawer(chairId){
    const chat=selection().chat;if(!chat)return;
    const data=await api.drawer({chatId:chat.id,chairId});
    const notes=data.drawer?.notes??[];
    openDialog(`${data.label} · Drawer`, `<p class="field-help">Inspecting recorded chair work. These records keep their original author and perspective.</p>${notes.map(n=>{const r=n.revisions.at(-1);return `<details class="drawer-note" open><summary>${esc(n.name)}</summary><small>Recorded by ${esc(r.author)} · ${esc(r.model)} · ${esc(new Date(r.at).toLocaleString())}</small><div class="markdown-body">${renderMarkdown(r.text)}</div><small>${n.revisions.length} saved revision${n.revisions.length===1?'':'s'}</small></details>`;}).join('')||'<p>No drawer notes saved yet. This chair can keep unfinished work here using its desk tools.</p>'}${reasoningNotesView(getState(),{chatId:chat.id,chairId})}<details><summary>Work log</summary><pre class="drawer-log">${esc(data.log.text||'No work recorded yet.')}</pre>${data.log.nextOffset!==null?`<button type="button" class="quiet-button" data-desk-action="log-page" data-chair="${esc(chairId)}" data-offset="${data.log.nextOffset}" data-snapshot="${esc(data.log.hash)}">Read next passage</button>`:''}</details>`,'drawer-dialog');
  }
  async function inspect(row){
    const state=getState();
    if(row.type==='chair'){if(selection().chat?.id!==row.chatId)await navigate(row.rootId,row.chatId,state.roots.find(r=>r.id===row.rootId)?.mode??'personal');return drawer(row.chairId);}
    const records=(state.handoffs?.records??[]).filter(r=>r.taskId===row.sourceId),messages=state.messages.filter(m=>m.exchangeId===row.sourceId);
    openDialog('Recorded task log',`<p>Inspecting ${esc(row.title)} · ${esc(row.desk)}. Original records retain their source and author.</p><pre class="drawer-log">${esc(JSON.stringify({task:row,messages,records},null,2))}</pre>`);
  }
  async function poll(){
    if(closed||inFlight)return;inFlight=true;
    try{const result=await api.activity();rows=result.rows;const changed=JSON.stringify(rows)!==lastRows;lastRows=JSON.stringify(rows);if(result.sequence!==sequence){sequence=result.sequence;await sync();}if(changed){renderActivity();renderConversation();}}
    catch{/* A disconnected app is handled by the existing connection UI. */}finally{inFlight=false;}
  }
  const timer=setInterval(poll,1000);
  document.addEventListener('change',event=>{if(event.target.matches('[data-desk-filter]')){currentOnly=event.target.checked;renderActivity();}});
  document.addEventListener('click',event=>{const button=event.target.closest('[data-desk-action]');if(!button)return;event.preventDefault();void(async()=>{
    const action=button.dataset.deskAction,chat=selection().chat,state=getState();
    if(action==='mention'){
      const r=chairRoster(state,chat),chair=[r.desk,...r.visitors].find(c=>c.id===button.dataset.chair),end=input.selectionStart??input.value.length,part=/(?:^|\s)@([^\s@{}]*)$/.exec(input.value.slice(0,end));
      if(!chair||!part)return;const start=end-part[0].length+(part[0].startsWith('@')?0:1);input.setRangeText(chairMention(chair.name)+' ',start,end,'end');input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));return;
    }
    if(action==='drawer')return drawer(button.dataset.chair);
    if(action==='log-page'){const d=await api.drawer({chatId:chat.id,chairId:button.dataset.chair,offset:button.dataset.offset,snapshot:button.dataset.snapshot});openDialog('Recorded chair log',`<p>${esc(d.log.view)}</p><pre class="drawer-log">${esc(d.log.text)}</pre>${d.log.nextOffset!==null?`<button type="button" class="quiet-button" data-desk-action="log-page" data-chair="${esc(button.dataset.chair)}" data-offset="${d.log.nextOffset}" data-snapshot="${esc(d.log.hash)}">Read next passage</button>`:''}`);return;}
    const row=rows.find(r=>r.id===button.dataset.task);if(!row)return;
    if(action==='stop'){button.disabled=true;await api.stopTask(row.id);toast('Stop requested for this task. Other chairs continue.');return poll();}
    if(action==='open'){document.getElementById('work-controls').open=false;await navigate(row.rootId,row.chatId,state.roots.find(r=>r.id===row.rootId)?.mode??'personal');renderConversation();return;}
    if(action==='log')return inspect(row);
  })().catch(error=>reportError(error.message));});
  drawerButton.addEventListener('click',()=>{const state=getState(),chat=selection().chat;if(!chat)return;const r=chairRoster(state,chat),chairs=[r.desk,...r.visitors];for(const d of state.deskWork?.drawers??[])if(d.chatId===chat.id&&!chairs.some(c=>c.id===d.chairId))chairs.push({id:d.chairId,name:(state.deskWork.tasks.findLast(t=>t.chairId===d.chairId)?.label??'Archived chair')+' (archived)'});openDialog('Chair drawers',`<p>Choose a chair’s recorded work to inspect. Each drawer remains tied to that chair.</p><div class="drawer-choices">${chairs.map(c=>`<button type="button" class="quiet-button" data-desk-action="drawer" data-chair="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>`);});
  input.addEventListener('input',renderComposer);input.addEventListener('click',renderComposer);
  window.addEventListener('pagehide',()=>{closed=true;clearInterval(timer);activitySize.disconnect();controls.removeEventListener('toggle',fitActivityMenu);window.removeEventListener('resize',fitActivityMenu);},{once:true});
  return {render(){renderActivity();renderComposer();renderConversation();},refresh:poll,parsed(){return routingFor(getState(),selection().chat,input.value);}};
}
