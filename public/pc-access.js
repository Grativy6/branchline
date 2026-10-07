import { api } from './api.js';
import { sketchDestination } from './sketch-format.js';
const e=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountPcAccess(container,state,reportError) {
  let status, removed=[];
  const modelChoices = selected => state.models.map(m=>`<label class="pc-recipient"><input type="checkbox" data-model="${e(m.id)}" ${selected.includes(m.id)?'checked':''}> ${e(m.name)} <small>${m.runtime==='codex'?'Sends file text to OpenAI':e(m.model)+' · '+e(m.baseUrl)}</small></label>`).join('');
  const rootRow=r=>`<fieldset class="pc-root" data-id="${e(r.id??'')}"><legend>Permitted folder</legend><label class="form-field">Name<input name="label" maxlength="100" value="${e(r.label??'Project')}" required></label><label class="form-field">Folder path<input name="path" value="${e(r.path??'')}" placeholder="C:\\Projects\\My project" maxlength="220" required></label><label><input type="checkbox" name="folderWrite" ${r.write?'checked':''}> Allow text file changes here</label><details open><summary>Models allowed to receive this folder’s contents</summary>${modelChoices(r.modelIds??[])}</details><button type="button" class="quiet-button" data-remove-root>Remove folder</button></fieldset>`;
  const deniedRow=d=>`<fieldset class="pc-denied" data-id="${e(d.id??'')}"><label class="form-field">Do not access<input name="path" value="${e(d.path??'')}" maxlength="220" ${d.id?'readonly':''} required></label><label><input type="checkbox" name="directory" ${d.directory!==false?'checked':''} ${d.id?'disabled':''}> Entire folder and everything inside it</label><button type="button" class="quiet-button" data-remove-denied>Remove exclusion…</button></fieldset>`;
  const sync=()=>{const f=container.querySelector('form');if(!f)return;f.elements.write.disabled=!f.elements.read.checked;if(!f.elements.read.checked)f.elements.write.checked=false;};
  const render=()=>{
    if(!container.isConnected)return;const s=status.settings;
    container.innerHTML=`<form id="pc-access-form"><h3>Agent PC access</h3><p class="field-help">Give a chair a project folder to read or edit. Its Coat pockets and the chat’s Tools switch must also allow the file tools.</p>
      <p class="notice">${status.available?'Text files are available in this preview.':'File tools need the Windows desktop build.'} Programs and screen control are still being prepared.</p>
      <label class="agent-opt-in"><input type="checkbox" name="read" ${s?.read?'checked':''} ${!status.available?'disabled':''}> Read permitted PC files</label>
      <label class="agent-opt-in"><input type="checkbox" name="write" ${s?.write?'checked':''}> Write permitted text files</label>
      <p class="field-help">Turning Read off clears the model choices. Turning it back on requires choosing them again. Do not access stays in force.</p>
      <div data-pc-roots>${(s?.roots??[]).map(r=>rootRow({...r,modelIds:r.destinations.filter(d=>state.models.some(m=>m.id===d.id&&m.model===d.model&&(m.runtime??'compatible')===d.runtime&&m.baseUrl===d.baseUrl)).map(d=>d.id)})).join('')}</div>
      <button class="quiet-button" type="button" data-add-root>Add a folder</button>
      <h4>Do not access</h4><p class="field-help">Files and folders here remain excluded, including during read-only use. App data, credentials and runtime files are protected automatically. Links and cloud placeholders are unavailable.</p>
      <div data-pc-denied>${(s?.denied??[]).map(deniedRow).join('')}</div><button class="quiet-button" type="button" data-add-denied>Add an exclusion</button>
      <div class="pc-unavailable"><label><input type="checkbox" disabled> Run programs</label><label><input type="checkbox" disabled> View an app session</label><label><input type="checkbox" disabled> Interact with an app</label><p class="field-help">${e(status.reason)}</p></div>
      <p class="field-help">File material keeps its sharing restrictions in later replies and handoffs. Sketches made after file access conservatively carry those restrictions across desks. A model’s request or a prompt never grants access.</p>
      <details><summary>Edits and recovery</summary><p class="field-help">Original bytes are saved before an edit. If interrupted, inspect its recorded result before retrying. Recovery copies: <span class="pc-path">${e(status.recoveryDirectory??'workspace/pc-recovery')}</span>. Compare the current file with the recorded “after” hash before restoring; preserve later changes.</p></details>
      <div class="dialog-footer"><button class="primary-button" type="submit">Save PC access</button></div><p role="status" data-pc-status></p></form><hr>`;sync();
  };
  container.addEventListener('change',sync);
  container.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-add-root'))container.querySelector('[data-pc-roots]').insertAdjacentHTML('beforeend',rootRow({}));
    if(b.hasAttribute('data-add-denied'))container.querySelector('[data-pc-denied]').insertAdjacentHTML('beforeend',deniedRow({}));
    if(b.hasAttribute('data-remove-root'))b.closest('fieldset').remove();
    if(b.hasAttribute('data-remove-denied')){const row=b.closest('fieldset');if(confirm('Remove this Do not access exclusion? Allowed folders could then include it.')){if(row.dataset.id)removed.push(row.dataset.id);row.remove();}}
  });
  container.addEventListener('submit',event=>{
    event.preventDefault();event.stopPropagation();const form=event.target;
    const roots=[...form.querySelectorAll('.pc-root')].map(r=>({id:r.dataset.id||null,label:r.querySelector('[name=label]').value,path:r.querySelector('[name=path]').value,write:r.querySelector('[name=folderWrite]').checked&&form.elements.write.checked,modelIds:[...r.querySelectorAll('[data-model]:checked')].map(x=>x.dataset.model)}));
    for(const root of roots)root.modelSnapshots=root.modelIds.map(id=>sketchDestination(state.models.find(m=>m.id===id)));
    const denied=[...form.querySelectorAll('.pc-denied')].map(r=>({id:r.dataset.id||null,path:r.querySelector('[name=path]').value,directory:r.querySelector('[name=directory]').checked}));
    const button=form.querySelector('[type=submit]');button.disabled=true;
    void api.pcAccessSave({baseRevision:status.settings?.id??null,read:form.elements.read.checked,write:form.elements.write.checked,roots,denied,removeDenied:removed}).then(s=>{status=s;removed=[];render();container.querySelector('[data-pc-status]').textContent='Saved. The next reply will wear the updated apron.';}).catch(err=>reportError(err.message)).finally(()=>{if(button.isConnected)button.disabled=false;});
  });
  void api.pcAccess().then(s=>{status=s;render();}).catch(err=>{if(container.isConnected)container.innerHTML=`<p class="notice">${e(err.message)}</p>`;});
}
