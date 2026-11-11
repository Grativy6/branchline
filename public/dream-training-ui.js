import {conversationMessage} from './conversation-records.js';
import {api} from './api.js';
import {dreamTraining,dreamNotes,currentDreamRun,dreamPortrait,dreamPhase,DREAM_ACTIVE,DREAM_FOCI} from './dream-training-state.js';
import {visiblePersonalModels} from './dream-records.js';
import {personalLabel} from './personal-label.js';
import {isModelArchived} from './model-archives.js';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,attrs='',kind='quiet-button')=>`<button type="button" class="${kind}" data-dream-job="${action}" ${attrs}>${label}</button>`;
const noteTitle=text=>(text??'').replace(/\s+/g,' ').trim().slice(0,70)||'Conversation note';
const destination=m=>m.runtime==='codex'?'OpenAI · ChatGPT subscription':m.runtime==='openai'?'OpenAI API':'Local connection';
export function dreamsSettings(state,engine=null){
  const settings=dreamTraining(state).settings,models=state.models.filter(m=>!isModelArchived(state,m.id));
  return `<form id="dream-settings-form"><h3>Prepare Dream notes</h3><div class="form-field dream-settings-preparer"><label for="dream-preparer-model">Preparation model</label><select id="dream-preparer-model" name="preparerModelId"><option value="" ${settings.preparerModelId===null?'selected':''}>Selected personal model · local</option>${settings.preparerModelId&&!models.some(m=>m.id===settings.preparerModelId)?`<option value="${e(settings.preparerModelId)}" selected>Saved preparation model is unavailable</option>`:''}${models.map(m=>`<option value="${e(m.id)}" ${settings.preparerModelId===m.id?'selected':''}>${e(m.name)} · ${e(destination(m))}</option>`).join('')}</select></div><p class="field-help">This model helps prepare your chosen notes. The personal model selected in Home is the one that learns from them. A cloud preparation model receives the selected material through that connection.</p><button class="primary-button" type="submit">Save Dream settings</button><p role="status" id="dream-settings-status"></p></form><section class="dream-engine"><h3>Local training</h3><p id="dream-engine-summary">${engine?.available?`${e(engine.backend==='wsl'?'Ubuntu / WSL 2':'Windows')} · ${e(engine.gpu||'local GPU')} · Qwen3.5-4B`:'The local training engine has not been configured.'}</p>${button('setup',engine?.available?'Check or repair local training':'Set up local training')}<p class="field-help">The first setup downloads the training libraries and the model checkpoint once. Training uses this computer’s GPU; no cloud GPU is rented.</p><p id="dream-engine-status" role="status"></p></section><section><h3>Dreams and schedules</h3><p>Mark a conversation or workflow, or add a note in Home. Start Dreaming when you are ready. Schedules run while Branchline is open.</p>${button('home','Open Dreams')}</section>`;
}

export function createDreamControls({getState,getPersonalId,getChat,applyState,render,toast,reportError,openSettings,openHome}){
  const dialog=document.createElement('dialog');dialog.id='dream-job-dialog';dialog.className='app-dialog dream-job-dialog';document.body.append(dialog);
  let busy=false,heldRun=null,engine=null,timer=null,setupTimer=null,selectedText='',selectedMessageIds=[],draftDirty=false;
  const currentPerson=()=>getPersonalId()||dreamTraining(getState()).settings.targetPersonalId||visiblePersonalModels(getState())[0]?.id;
  const safe=fn=>(...args)=>Promise.resolve(fn(...args)).catch(err=>{const n=dialog.querySelector('[data-dream-error]')||document.getElementById('dream-settings-status');if(n)n.textContent=err.message;else reportError(err.message);});
  const show=(title,body)=>{dialog.innerHTML=`<header class="dialog-heading"><h2>${e(title)}</h2>${button('close','×','aria-label="Close"','icon-button')}</header>${body}<p data-dream-error role="status" class="field-help"></p>`;if(!dialog.open)dialog.showModal();};
  async function call(route,input){const value=await api.dreams(route,input);if(value.state)applyState(value.state);return value.result;}
  async function cancelHold(){const id=heldRun;heldRun=null;if(id)await call('/control',{id,action:'cancel-hold'});}
  dialog.addEventListener('close',safe(async()=>{draftDirty=false;await cancelHold();}));
  dialog.addEventListener('cancel',()=>{draftDirty=false;});
  function noteForm(kind,prior=null,source=null){
    dialog.dataset.fileName=source?.fileName??'';
    const person=source?.personalId??currentPerson();if(!person){openSettings();toast('Add a personal model in Models first.');return;}
    heldRun=null;show(kind==='conversation'?'Make noted conversation':'Make noted workflow',`<form id="dream-note-form" data-focus="${kind}" data-personal-id="${e(prior?.personalId??person)}" ${prior?`data-note-id="${e(prior.noteId)}" data-revision="${e(prior.id)}"`:''}><label class="form-field">Name<input name="name" value="${e(prior?.name??source?.name??'')}" maxlength="200" required></label><label class="form-field">Text<textarea name="text" rows="13" required>${e(source?.text??'')}</textarea></label><input type="file" id="dream-note-file" accept=".txt,.md,.text,text/plain,text/markdown" hidden><div class="dream-form-actions">${button('browse-note','Browse…')}<span id="dream-note-file-name"></span></div><div class="dialog-footer"><button type="submit" class="primary-button">Add to Dream list</button>${button('close','Cancel')}</div></form>`);dialog.querySelector('[name=name]').focus();
  }
  function markDialog(input){show('Use in Dreams',`<p>${input.kind==='desk'?'This desk’s saved conversations':input.kind==='conversation'?'This saved conversation':input.kind==='passage'?'The highlighted passage and its context':'This response and its context'}</p><div class="dream-purpose-actions">${button('mark-conversation','Conversation flow','','primary-button')}${button('mark-workflow','Workflow','','primary-button')}</div>`);dialog.markInput=input;}
  function markMenu(){const {chat,root}=getChat();if(!chat)return;show('Use in Dreams',`<div class="dream-mark-options">${button('mark-selection','Highlighted text',selectedText?'':'disabled')}${selectedMessageIds.length>1?button('mark-range','Selected messages'):''}${button('mark-chat','This conversation')}${button('mark-desk','This desk')}</div>`);}
  function scheduleForm(personalId){
    const q=dreamTraining(getState()).schedules.find(q=>q.personalId===personalId),date=new Date(Date.now()+3600000),localDate=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString(),s=q?.schedule??{date:localDate.slice(0,10),time:localDate.slice(11,16),zone:Intl.DateTimeFormat().resolvedOptions().timeZone,repeat:'once',intervalMinutes:1440,weekdays:[date.getDay()]};
    show('Schedule Dreams',`<form id="dream-schedule-form" data-personal-id="${e(personalId)}"><p>Uses pending notes for this personal model while Branchline is open. With nothing new, it stays quiet.</p><div class="dream-date-fields"><label class="form-field">Date<input type="date" name="date" value="${e(s.date)}" required></label><label class="form-field">Time<input type="time" name="time" value="${e(s.time)}" required></label></div><label class="form-field">Time zone<input name="zone" value="${e(s.zone)}" required></label><label class="form-field">Repeat<select name="repeat">${[['once','Once'],['daily','Daily'],['weekdays','Selected weekdays'],['interval','Interval']].map(([v,l])=>`<option value="${v}" ${v===s.repeat?'selected':''}>${l}</option>`).join('')}</select></label><div class="dream-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=>`<label><input type="checkbox" name="weekday" value="${i}" ${s.weekdays.includes(i)?'checked':''}>${d}</label>`).join('')}</div><label class="form-field">Interval in minutes<input type="number" min="1" max="43200" name="intervalMinutes" value="${s.intervalMinutes}"></label><label class="form-field">If a time was missed<select name="missed"><option value="skip" ${q?.missed!=='latest'?'selected':''}>Skip the missed occurrence</option><option value="latest" ${q?.missed==='latest'?'selected':''}>Run the latest when available</option></select></label><label class="check-line"><input type="checkbox" name="enabled" ${q?.enabled!==false?'checked':''}>Enable this schedule</label><div class="dialog-footer"><button class="primary-button" type="submit">Save schedule</button>${button('close','Cancel')}</div></form>`);
  }
  async function reviewRun(id){
    const r=dreamTraining(getState()).runs.find(r=>r.id===id);if(!r)return;const prepared=await api.dreams('/prepared?'+new URLSearchParams({id}));
    show('Dream work',`<p><strong>${e(dreamPhase(r))}</strong></p><p>Prepared with ${e(r.preparer.name)} · ${r.items.length} note(s)</p>${r.status==='ready'?`<p>A new generation is available. Your current generation is kept until you choose this one.</p>${button('try','Try this generation',`data-id="${e(id)}"`)} ${button('adopt','Use this generation',`data-id="${e(id)}"`,'primary-button')} ${button('previous','Use the previous generation',`data-id="${e(id)}"`)}`:''}${['suspended','interrupted'].includes(r.status)?button('resume','Resume Dream',`data-id="${e(id)}"`)+button('stop','Stop Dream',`data-id="${e(id)}"`):''}<details><summary>Prepared examples (${prepared.examples.length})</summary>${prepared.examples.map((x,index)=>`<article class="dream-example"><p class="field-help">${e(x.episodeId)}</p>${button('edit-prepared','Edit for a later Dream',`data-id="${e(id)}" data-index="${index}"`,'text-button')}${x.messages.map(m=>`<p><strong>${e(m.role)}</strong></p><pre>${e(m.content)}</pre>`).join('')}</article>`).join('')||'<p>No examples have been prepared yet.</p>'}</details>${prepared.responses?.length?`<details><summary>Preparation responses</summary>${prepared.responses.map(r=>`<p>${e(r.source)} · ${e(r.model)}</p><pre>${e(r.text)}</pre>`).join('')}</details>`:''}<details><summary>Run details</summary><pre>${e(JSON.stringify({recipe:r.recipe,progress:r.progress,resources:r.resources,result:r.result,error:r.error,loadError:r.loadError},null,2))}</pre></details>`);
  }
  const click=safe(async event=>{
    const target=event.target.closest('[data-dream-job]');if(!target)return;event.preventDefault();if(busy)return;
    const action=target.dataset.dreamJob,id=target.dataset.id,pid=target.dataset.personalId||currentPerson();
    if(action==='close'){dialog.close();return;}
    if(action==='manual-conversation'||action==='manual-workflow'){noteForm(action.endsWith('workflow')?'workflow':'conversation');return;}
    if(action==='settings'){openSettings();return;}if(action==='home'){openHome();return;}
    if(action==='browse-note'){dialog.querySelector('#dream-note-file').click();return;}
    if(action==='picture'){document.getElementById('dream-picture-file')?.click();return;}
    if(action==='mark-menu'){markMenu();return;}
    if(action==='mark-message'){const m=conversationMessage(getState(),id);if(m)markDialog({kind:'message',chatId:m.chatId,messageIds:[m.id],name:noteTitle(m.content)});return;}
    if(action==='mark-chat'){const {chat}=getChat();markDialog({kind:'conversation',chatId:chat.id,name:chat.title});return;}
    if(action==='mark-desk'){const {root}=getChat();markDialog({kind:'desk',rootId:root.id,name:root.name});return;}
    if(action==='mark-selection'){const {chat}=getChat();const ids=selectedMessageIds;markDialog({kind:'passage',chatId:chat.id,text:selectedText,...(ids.length?{messageIds:ids}:{}),name:noteTitle(selectedText)});return;}
    if(action==='mark-range'){const {chat}=getChat();markDialog({kind:'range',chatId:chat.id,messageIds:selectedMessageIds,name:chat.title+' · selected messages'});return;}
    if(action==='schedule'){scheduleForm(pid);return;}
    if(action==='view-note'||action==='edit-note'){const n=await api.dreams('/note?'+new URLSearchParams({id}));if(action==='edit-note')noteForm(n.note.focus,n.note,n.source);else show(n.note.name,`<p>${e(DREAM_FOCI[n.note.focus])} · ${e(n.note.origin)}</p><pre class="dream-source-text">${e(n.source.text)}</pre>${button('edit-note','Edit note',`data-id="${e(n.note.id)}"`)}`);return;}
    if(action==='review-run'){await reviewRun(id);return;}
    if(action==='edit-prepared'){const r=dreamTraining(getState()).runs.find(r=>r.id===id),p=await api.dreams('/prepared?'+new URLSearchParams({id})),example=p.examples[Number(target.dataset.index)];if(example)noteForm(example.focus??'conversation',null,{personalId:r.personalId,name:'Prepared conversation note',text:example.messages.map(m=>m.role+': '+m.content).join('\n\n')});return;}
    if(action==='try'){show('Try the new generation',`<form id="dream-try-form" data-id="${e(id)}"><label class="form-field">Message<textarea name="prompt" rows="4" required></textarea></label><button type="submit" class="primary-button">Compare current and new</button><div id="dream-try-results"></div></form>`);return;}
    busy=true;try{
      if(action==='start'){await call('/start',{personalId:pid});toast('Dream started');}
      else if(action==='manage'){
        await call('/control',{id,action:'hold'});heldRun=id;show('Manage Dream',`<p data-dream-running-phase>${e(dreamPhase(currentDreamRun(getState(),pid)))}</p><div class="dream-purpose-actions">${button('stop','Stop Dream',`data-id="${e(id)}"`)}${button('suspend','Suspend Dream',`data-id="${e(id)}"`)}${button('close','Cancel')}</div>`);
      }else if(['stop','suspend','resume'].includes(action)){heldRun=null;await call('/control',{id,action});dialog.close();}
      else if(action==='mark-conversation'||action==='mark-workflow'){await call('/note',{...dialog.markInput,focus:action==='mark-workflow'?'workflow':'conversation'});dialog.close();toast('Added to Dreams');}
      else if(action==='remove-note')await call('/remove',{noteId:id});
      else if(action==='remove-picture')await call('/portrait',{personalId:pid,data:null});
      else if(action==='adopt'||action==='previous'){await call('/adopt',{id,previous:action==='previous'});dialog.close();toast(action==='previous'?'Previous generation selected':'New generation selected');}
      else if(action==='setup'){const r=await call('/setup',{});toast(r?.message||'Training setup started');await refreshEngine();}
    }finally{busy=false;render();}
  });
  function captureSelection(){
    const selection=window.getSelection(),parts=[];selectedMessageIds=[];
    if(selection?.rangeCount&&!selection.isCollapsed){const range=selection.getRangeAt(0);
      for(const body of document.querySelectorAll('.message[data-message-id] .message-body')){
        if(!range.intersectsNode(body))continue;const part=document.createRange();part.selectNodeContents(body);
        if(range.compareBoundaryPoints(Range.START_TO_START,part)>0)part.setStart(range.startContainer,range.startOffset);
        if(range.compareBoundaryPoints(Range.END_TO_END,part)<0)part.setEnd(range.endContainer,range.endOffset);
        const text=part.toString();if(text.trim()){parts.push(text);selectedMessageIds.push(body.closest('.message').dataset.messageId);}
      }
    }selectedText=parts.join('\n\n');
  }
  document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-dream-job="mark-menu"]'))captureSelection();});
  document.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.closest('[data-dream-job="mark-menu"]'))captureSelection();});
  document.addEventListener('click',click);
  document.addEventListener('change',safe(async event=>{
    const el=event.target;
    if(el.matches('[data-dream-include]'))await call('/choice',{personalId:currentPerson(),noteId:el.dataset.dreamInclude,included:el.checked});
    if(el.id==='dream-note-file'&&el.files[0]){const file=el.files[0];if(file.size>16*1024*1024)throw new Error('Choose a text file under 16 MB.');const bytes=new Uint8Array(await file.arrayBuffer());let encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';dialog.querySelector('[name=text]').value=new TextDecoder(encoding,{fatal:true}).decode(bytes);const name=dialog.querySelector('[name=name]');if(!name.value)name.value=file.name.replace(/\.[^.]+$/,'');dialog.querySelector('#dream-note-file-name').textContent=file.name;dialog.dataset.fileName=file.name;draftDirty=true;}
    if(el.id==='dream-picture-file'&&el.files[0]){const file=el.files[0];if(file.size>8*1024*1024)throw new Error('Choose a picture under 8 MB.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});await call('/portrait',{personalId:currentPerson(),data});}
  }));
  dialog.addEventListener('input',event=>{if(event.target.closest('#dream-note-form'))draftDirty=true;});
  document.addEventListener('submit',event=>{
    if(!['dream-note-form','dream-settings-form','dream-schedule-form','dream-try-form'].includes(event.target.id))return;event.preventDefault();event.stopImmediatePropagation();
    void safe(async()=>{
      if(busy)return;busy=true;const form=event.target,f=form.elements;
      try{
        if(form.id==='dream-note-form'){await call('/note',{kind:'manual',personalId:form.dataset.personalId,focus:form.dataset.focus,name:f.name.value,text:f.text.value,fileName:dialog.dataset.fileName??'',...(form.dataset.noteId?{noteId:form.dataset.noteId,baseRevisionId:form.dataset.revision}:{})});draftDirty=false;dialog.close();toast('Added to Dream list');}
        if(form.id==='dream-settings-form'){await call('/settings',{preparerModelId:f.preparerModelId.value||null});document.getElementById('dream-settings-status').textContent='Saved. Future Dreams will use this preparation model.';}
        if(form.id==='dream-schedule-form'){await call('/schedule',{personalId:form.dataset.personalId,enabled:f.enabled.checked,missed:f.missed.value,schedule:{date:f.date.value,time:f.time.value,zone:f.zone.value,repeat:f.repeat.value,intervalMinutes:Number(f.intervalMinutes.value),weekdays:[...form.querySelectorAll('[name=weekday]:checked')].map(x=>Number(x.value))}});dialog.close();toast('Dream schedule saved');}
        if(form.id==='dream-try-form'){f.prompt.readOnly=true;render();const result=await call('/try',{id:form.dataset.id,prompt:f.prompt.value});if(!form.isConnected||!dialog.open)return;document.getElementById('dream-try-results').innerHTML=result.answers.map(a=>`<h3>${e(a.name)}</h3><pre>${e(a.text)}</pre>`).join('');}
      }finally{busy=false;}
    })();
  },true);
  async function refreshEngine(){const view=await api.dreams();engine=view.engine;const summary=document.getElementById('dream-engine-summary');if(summary)summary.textContent=engine.available?((engine.backend==='wsl'?'Ubuntu / WSL 2':'Windows')+' · '+(engine.gpu||'local GPU')+' · Qwen3.5-4B'):'The local training engine has not been configured.';const panel=document.getElementById('dream-engine-status');if(panel)panel.textContent=view.setup?.active||view.setup?.phase==='failed'?view.setup.message:engine.available?'Local training engine is configured.':'Local training setup is needed.';clearTimeout(setupTimer);if(view.setup?.active)setupTimer=setTimeout(()=>refreshEngine().catch(reportError),2000);return view;}
  function refresh(){
    const run=currentDreamRun(getState(),currentPerson()),phase=dialog.querySelector('[data-dream-running-phase]');if(phase&&heldRun===run?.id)phase.textContent=dreamPhase(run);
    clearTimeout(timer);const manage=document.querySelector('[data-dream-job="manage"]');if(manage&&run){const left=2000-(Date.now()-Date.parse(run.at));manage.disabled=left>0;if(left>0)timer=setTimeout(()=>{if(manage.isConnected)manage.disabled=false;},left+15);}
  }
  async function prepareClose(){for(const run of dreamTraining(getState()).runs.filter(r=>DREAM_ACTIVE.has(r.status)))await call('/control',{id:run.id,action:'suspend'});const until=Date.now()+120000;while(Date.now()<until){const view=await api.dreams();if(!view.runs.some(r=>DREAM_ACTIVE.has(r.status)))return;await new Promise(r=>setTimeout(r,400));}throw new Error('The Dream is still saving its checkpoint. Keep Branchline open until it is suspended.');}
  return {refresh,refreshEngine,get engine(){return engine;},get busy(){return busy;},get unsaved(){return draftDirty;},get running(){return dreamTraining(getState()).runs.some(r=>DREAM_ACTIVE.has(r.status));},prepareClose,setTarget:id=>call('/target',{personalId:id})};
}
