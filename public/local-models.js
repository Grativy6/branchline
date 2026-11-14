import {api} from './api.js';
const e=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=n=>n==null?'Unknown size':(n/1073741824).toFixed(2)+' GiB';
export function localEngineLabel(status) {
  const engine=status?.engine;if(!engine)return '';
  const backend=status.backend==='vulkan'?'Vulkan':status.backend==='cpu'?'CPU':null;
  const state=status.phase==='ready'&&backend?'Running on '+backend:status.phase==='loading'&&backend?'Loading on '+backend:status.phase==='error'?'Not running':status.phase==='checking'?'Checking files':'Unloaded';
  return `${engine.name} ${engine.version} · ${engine.tag} · ${state}`;
}
export function createLocalModels({refresh,toast,reportError}){
  let data=null,candidate=null,selectedId=null,adding=null,loading=false,searchOpen=false,message='',closed=false,searchEpoch=0;
  const host=()=>document.getElementById('local-model-library');
  function render(){
    const panel=host();if(!panel||!data)return;const editingFolder=document.activeElement?.id==='local-model-folder'?document.activeElement.value:null;
    const selected=candidate??data.models.find(m=>m.modelId===selectedId),meta=selected?.metadata??selected;
    const saved=selected?.modelId?selected:data.models.find(m=>m.modelId===selected?.addedModelId);
    const status=saved?(saved.changed?'File changed; find and add the intended file again.':!saved.available?'File not found at its saved location.':saved.runtime?.phase==='ready'?'Loaded and ready.':saved.runtime?.message??'Saved; loads when used.'):'Preview — not added yet.';
    panel.innerHTML=`<h3>Your locally saved models</h3><div class="local-model-grid"><div class="local-model-list" role="listbox" aria-label="Saved local models">${data.models.length?data.models.map(m=>`<button type="button" role="option" aria-selected="${!candidate&&selectedId===m.modelId}" data-local-action="select" data-id="${e(m.modelId)}"><strong>${e(m.name)}</strong><small>${size(m.bytes)}</small></button>`).join(''):'<p>No local files added yet.</p>'}</div><div class="local-model-preview">${selected?`<h4>${e(selected.name||selected.path.split(/[\\/]/).at(-1))}</h4><p>${e(meta.description||'No descriptive note is embedded in this file.')}</p>${meta.descriptionSource?`<small>From ${e(meta.descriptionSource)}</small>`:''}<p>${e([meta.architecture,meta.sizeLabel,meta.inputFormat==='plain-dialogue-v1'?'Base model · text completion':'Chat template'].filter(Boolean).join(' · '))}</p><p>${size(selected.bytes)}</p><p class="detail-value">${e(selected.path)}</p><p>${e(selected.unsupportedReason??status)}</p>${candidate&&!saved&&!selected.unsupportedReason?`<label class="form-field">Name in Branchline<input id="local-model-name" maxlength="200" value="${e(selected.name||selected.path.split(/[\\/]/).at(-1).replace(/\.gguf$/i,''))}"></label>`:''}${saved?.runtime?.engine?`<p class="field-help local-engine-status">${e(localEngineLabel(saved.runtime))}</p>`:''}${saved?.runtime?`<small>Selected window: ${Number(saved.contextTokens).toLocaleString()} tokens${saved.runtime.loadedContextTokens?' · loaded '+Number(saved.runtime.loadedContextTokens).toLocaleString():''}</small>`:''}`:'<p>Select a saved model or find a model to preview its description.</p>'}<div class="local-model-actions"><button type="button" class="quiet-button" data-local-action="search">Search Local</button><a class="quiet-button" href="https://huggingface.co/models" target="_blank" rel="noopener noreferrer" data-local-action="online">Search Online</a><button type="button" class="primary-button" data-local-action="add" ${!candidate||saved||candidate.unsupportedReason||adding?'disabled':''}>${adding?'Adding…':saved&&candidate?'Already added':'Add Model'}</button><button type="button" class="text-button" data-local-action="remove" ${!saved||adding?'disabled':''}>Remove</button>${saved?.runtime?.phase==='ready'?'<button type="button" class="text-button" data-local-action="unload">Unload</button>':''}</div></div></div><p class="field-help" role="status">${e(message)}</p>${adding?'<button type="button" class="text-button" data-local-action="cancel-add">Cancel adding</button>':''}${searchOpen?`<div class="local-model-search"><label class="form-field">Model folder<input id="local-model-folder" placeholder="Choose a folder, or search familiar locations" value="${e(data.search?.folders[0]??data.folders.at(-1)??'')}"></label><div class="harness-actions"><button type="button" class="quiet-button" data-local-action="browse" ${window.branchlineLocalModelPicker?'':'hidden'}>Choose a folder</button><button type="button" class="primary-button" data-local-action="find">Find models</button><button type="button" class="text-button" data-local-action="familiar">Search familiar folders</button>${data.search?.phase==='searching'?'<button type="button" class="text-button" data-local-action="cancel-search">Stop search</button>':''}</div><div id="local-model-search-results">${results()}</div></div>`:''}`;
    if(editingFolder!==null){const input=document.getElementById('local-model-folder');if(input){input.value=editingFolder;input.focus({preventScroll:true});}}
  }
  function results(){const s=data?.search;if(!s)return '<p class="field-help">Searching lists candidates; choose one to preview before adding.</p>';return `<p class="field-help">${e(s.phase==='searching'?'Searching '+s.currentFolder:s.phase==='complete'?'Search complete.':s.phase==='cancelled'?'Search stopped.':s.error??s.phase)} · ${s.candidates.length} file(s)</p><div class="local-model-results">${s.candidates.map(c=>`<button type="button" class="quiet-button" data-local-action="preview" data-id="${e(c.candidateId)}"><strong>${e(c.name||c.path.split(/[\\/]/).at(-1))}</strong><small>${size(c.bytes)}${c.addedModelId?' · already added':''}${c.unsupportedReason?' · '+e(c.unsupportedReason):''}</small><small class="detail-value">${e(c.path)}</small></button>`).join('')}</div>${s.errors.length?`<p class="field-help">${s.errors.length} folder(s) could not be read. Choose a more specific folder if needed.</p>`:''}`;}
  async function mount(){if(!host()||loading)return;loading=true;try{data=await api.localModels();render();}catch(error){reportError(error.message);}finally{loading=false;}}
  async function search(folder){const epoch=++searchEpoch;candidate=null;data={...data,search:null};render();const found=await api.localModelsSearch(folder);if(epoch!==searchEpoch)return;data={...data,search:found};searchOpen=true;message='';render();}
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-local-action]');if(!button)return;
    const action=button.dataset.localAction;if(action==='online')return;
    event.preventDefault();void(async()=>{
      if(action==='select'){candidate=null;selectedId=button.dataset.id;message='';render();return;}
      if(action==='search'){searchOpen=true;render();if(!data.search&&data.folders.length)await search(null);return;}
      if(action==='find')return search(document.getElementById('local-model-folder').value.trim()||null);
      if(action==='familiar')return search(null);
      if(action==='cancel-search'){await api.localModelsCancel(data.search.id);return mount();}
      if(action==='browse'){window.chrome?.webview?.postMessage({type:'local-model-folder'});return;}
      if(action==='preview'){candidate=data.search.candidates.find(c=>c.candidateId===button.dataset.id);selectedId=null;message='';render();return;}
      if(action==='cancel-add'){adding?.abort();return;}
      if(action==='add'){
        if(!candidate||adding)return;const name=document.getElementById('local-model-name')?.value??candidate.name,chosen=candidate,searchId=data.search.id;
        adding=new AbortController();message='Saving this model’s file identity. The model stays in its current folder.';render();
        try{const result=await api.localModelsAdd({searchId,candidateId:chosen.candidateId,name},adding.signal);selectedId=result.modelId;candidate=null;message=result.alreadyAdded?'This model is already in your list.':'Added. Choose it in a chair when you want to use it.';await refresh();}
        catch(error){if(error.name==='AbortError')message='Adding stopped. Refreshing the saved list.';else throw error;}
        finally{adding=null;await mount();}return;
      }
      if(action==='remove'){const id=candidate?.addedModelId??selectedId;if(!id)return;await api.localModelsRemove(id);candidate=null;selectedId=null;message='Removed from the list. The model file remains on disk.';await refresh();return mount();}
      if(action==='unload'){data=await api.localModelsUnload();render();}
    })().catch(error=>{message=error.message;render();});
  });
  window.chrome?.webview?.addEventListener('message',event=>{if(event.data?.type==='local-model-folder'&&event.data.path){const input=document.getElementById('local-model-folder');if(input)input.value=event.data.path;void search(event.data.path).catch(error=>reportError(error.message));}});
  const timer=setInterval(()=>{if(closed||!host()||loading||adding||data?.search?.phase!=='searching')return;loading=true;void api.localModels().then(next=>{data=next;const target=document.getElementById('local-model-search-results');if(target)target.innerHTML=results();const stop=document.querySelector('[data-local-action="cancel-search"]');if(stop)stop.hidden=data.search?.phase!=='searching';}).catch(error=>reportError(error.message)).finally(()=>{loading=false;});},500);
  window.addEventListener('pagehide',()=>{closed=true;clearInterval(timer);adding?.abort();},{once:true});
  return {mount};
}
