import {api} from './api.js';
import {sessionFetch} from './session.js';
import {pointInBoundary,polygonArea,simplifyPoints} from './easel-format.js';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=prefix=>prefix+'_'+crypto.randomUUID();
const copy=v=>structuredClone(v);
const colors=[['Charcoal','#283845'],['Blue','#2476cb'],['Green','#338369'],['Yellow','#e7b64c'],['Pink','#ce476e'],['White','#ffffff']];

export function createEasel({getChatId,onAttached,openConnection,toast}){
 let dialog=null,project=null,tool='sketch',color=colors[1][1],size=5,zoom=1,pan={x:0,y:0},stage=null,layer=null,group=null;
 let view={scale:1,x:0,y:0},gesture=null,selectedText=null,textDirty=false,chain=Promise.resolve(),pending=0,saveFailed=false,drawEpoch=0;
 let preview=null,previewAfter=true,listing={projects:[],jobs:[],backends:[]},timer=null,closed=true,opening=0,space=false;
 const urls=new Map(),images=new Map();let observer;
 const promptDrafts=new Map();
 const $=selector=>dialog.querySelector(selector);
 const status=(text,error=false)=>{if(!dialog)return;const el=$('[data-role=status]');el.textContent=text;el.classList.toggle('error',error);};
 const handle=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>status(error.message,true));
 const canvasName=()=>project?.name??'Untitled';
 async function blobURL(route){if(!urls.has(route)){const res=await sessionFetch(route);if(!res.ok){let error;try{error=await res.json();}catch{}throw new Error(error?.error??'Could not open this saved picture.');}urls.set(route,URL.createObjectURL(await res.blob()));}return urls.get(route);}
 async function image(route){const url=await blobURL(route);if(!images.has(url)){const img=new Image();images.set(url,new Promise((resolve,reject)=>{img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not display the picture.'));img.src=url;}));}return images.get(url);}
 function bind(){
  dialog=document.createElement('dialog');dialog.id='easel-dialog';dialog.className='app-dialog easel-window';
  dialog.innerHTML=`<div class="easel-header"><div><h2>Easel</h2><span class="field-help">A little room to show what you mean.</span></div><button class="icon-button" data-easel="close" aria-label="Close Easel">×</button></div>
   <div class="easel-files"><button data-easel="new">New</button><button data-easel="open">Open…</button><select aria-label="Saved Easel projects" data-role="projects"><option value="">Saved projects</option></select><input data-role="name" aria-label="Picture name" maxlength="120" placeholder="Picture name"><button data-easel="export-project">Save project…</button><button data-easel="export-picture">Save picture…</button><input type="file" data-role="file" accept=".png,.jpg,.jpeg,.webp,.json" hidden></div>
   <div class="easel-toolbar" aria-label="Easel tools"><button data-tool="text">Text</button><button data-tool="sketch">Sketch</button><button data-tool="boundary">Work boundary</button><button data-easel="undo" aria-label="Undo last Easel change">↶ Undo</button><span class="easel-tool-gap"></span><div class="easel-colors" aria-label="Drawing colors">${colors.map(([name,value])=>`<button data-color="${value}" aria-label="${name}" title="${name}"></button>`).join('')}</div><label class="easel-size">Size <input data-role="size" type="range" min="2" max="40" value="5" aria-label="Stroke size"></label></div>
   <div class="easel-main"><div class="easel-canvas-wrap"><div data-role="canvas" class="easel-canvas" aria-label="Image drawing canvas" tabindex="0"></div><div class="easel-canvas-footer"><span data-role="hint">Open a picture or begin with a blank canvas.</span><div><button data-easel="zoom-out" aria-label="Zoom out">−</button><button data-easel="fit">Fit</button><button data-easel="zoom-in" aria-label="Zoom in">+</button></div></div></div>
    <aside class="easel-aside"><label data-role="text-panel" hidden>Text to place or edit<textarea data-role="text" rows="3" maxlength="1500" placeholder="Write a note, then click the picture"></textarea></label>
     <div class="easel-scope"><strong>See: whole picture</strong><span data-role="boundary-label">Edit: whole canvas</span><small>AI sees a 1024 px overview.</small><small>Edges blend inside your boundary.</small><button class="text-button" data-easel="whole">Use whole canvas</button></div>
     <label>What should change?<textarea data-role="prompt" rows="4" maxlength="4000" placeholder="Or put your instructions right on the picture."></textarea><small class="field-help" data-role="prompt-limit" hidden></small></label>
     <label>Image connection<select data-role="backend"><option value="subscription">ChatGPT subscription</option></select></label><button class="text-button" data-easel="connection">Connect or check ChatGPT</button><p class="field-help" data-role="billing">No image request is sent until you ask.</p>
     <button data-easel="request" class="primary-button">Ask for edit</button><button data-easel="stop" hidden>Stop image</button>
     <section class="easel-proposal" data-role="proposal" hidden><strong>Image proposal</strong><p data-role="proposal-note"></p><div><button data-easel="compare">Show before</button><button data-easel="accept" class="primary-button">Accept edit</button><button data-easel="reject">Reject</button></div></section>
     <label class="check-line"><input data-role="include-marks" type="checkbox" checked>Include my text and sketches in saved/sent picture</label><button data-easel="send">Attach picture to chat</button><small class="field-help">Drag with the middle mouse button, or hold Space, to pan. Ctrl+Z undoes.</small>
    </aside></div><div class="easel-footer"><span data-role="status" role="status">Choose a picture.</span><span data-role="dimensions"></span></div>`;
  document.body.append(dialog);stage=new window.Konva.Stage({container:$('[data-role=canvas]'),width:600,height:500});layer=new window.Konva.Layer();stage.add(layer);
  dialog.addEventListener('click',handle(async event=>{
   const btn=event.target.closest('button');if(!btn)return;
   if(btn.dataset.tool){await commitText();tool=btn.dataset.tool;selectedText=null;buttons();return draw();}
   if(btn.dataset.color){color=btn.dataset.color;buttons();return;}
   const action=btn.dataset.easel;
   if(action==='close')return close();if(action==='connection'){await close();return openConnection();}if(action==='new'){await flush();return setProject(await api.easel('/create',{name:'Untitled',image:null,requestId:uid('create')}));}
   if(action==='open')return $('[data-role=file]').click();if(!project)return;
   if(action==='undo')return undo();
   if(action==='whole'){await commitText();project.doc.boundary=null;await save();return draw();}
   if(['zoom-in','zoom-out','fit'].includes(action)){if(action==='fit'){zoom=1;pan={x:0,y:0};}else zoom=Math.max(.25,Math.min(8,zoom*(action==='zoom-in'?1.25:.8)));return draw();}
   if(action==='export-project')return exportProject();
   if(action==='export-picture'){await flush();return download('/api/easel/picture?'+new URLSearchParams({id:project.id,marks:$('[data-role=include-marks]').checked}),canvasName()+'.png');}
   if(action==='send'){await flush();const chatId=getChatId();if(!chatId)throw new Error('Open a conversation before attaching a picture.');await api.easel('/send',{id:project.id,chatId,marks:$('[data-role=include-marks]').checked});await onAttached();status('Picture attached. It will be included when you send your message.');return;}
   if(action==='request'){await flush();const prompt=$('[data-role=prompt]').value.trim()||'Follow the text and sketch guidance in the marked picture.';preview=null;const job=await api.easel('/request',{id:project.id,version:project.version,backend:$('[data-role=backend]').value,prompt,requestId:uid('request')});listing.jobs.push(job);status('Making a picture… You can keep marking the canvas.');buttons();return poll();}
   if(action==='stop'){const job=listing.jobs.find(j=>j.status==='running');if(job){await api.easel('/cancel',{id:job.id});status('Stopping…');}return;}
   if(action==='compare'){previewAfter=!previewAfter;buttons();return draw();}
   if(action==='accept'||action==='reject'){await flush();if(!preview)return;const next=await api.easel('/decide',{id:project.id,version:project.version,jobId:preview.id,accept:action==='accept'});preview=null;previewAfter=true;await setProject(next);status(action==='accept'?'Edit accepted. Undo brings the previous picture back.':'Proposal rejected. Your picture is unchanged.');return;}
  }));
  $('[data-role=file]').addEventListener('change',handle(async event=>{
   const file=event.target.files?.[0];if(!file)return;await flush();if(file.size>64*1024*1024)throw new Error('Choose a project smaller than 64 MiB.');
   status('Opening…');let p;
   if(file.name.toLowerCase().endsWith('.json'))p=await api.easel('/import',{bundle:JSON.parse(await file.text()),requestId:uid('import')});
   else{if(file.size>10*1024*1024)throw new Error('Choose a picture smaller than 10 MiB.');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});p=await api.easel('/create',{name:file.name.replace(/\.[^.]+$/,''),image:{name:file.name,base64,origin:'pick'},requestId:uid('create')});}
   event.target.value='';await setProject(p);
  }));
  $('[data-role=projects]').addEventListener('change',handle(async event=>{await flush();if(event.target.value)await setProject(await api.easel('/project?'+new URLSearchParams({id:event.target.value})));}));
  $('[data-role=name]').addEventListener('change',handle(async()=>{if(project){project.name=$('[data-role=name]').value.trim()||'Untitled';await save();await refresh();}}));
  $('[data-role=size]').addEventListener('input',event=>{size=Number(event.target.value);});
  $('[data-role=backend]').addEventListener('change',buttons);
  $('[data-role=prompt]').addEventListener('input',buttons);
  $('[data-role=text]').addEventListener('input',()=>{if(selectedText&&project){const mark=project.doc.marks.find(m=>m.id===selectedText);if(mark){mark.text=$('[data-role=text]').value;textDirty=true;void draw();}}});
  $('[data-role=text]').addEventListener('change',handle(commitText));
  dialog.addEventListener('cancel',event=>{event.preventDefault();void close().catch(error=>status(error.message,true));});
  dialog.addEventListener('keydown',handle(async event=>{if(event.code==='Space'&&!event.target.matches('input,textarea,select,button')){space=true;event.preventDefault();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.target.matches('input,textarea')){event.preventDefault();await undo();}}));
  dialog.addEventListener('keyup',event=>{if(event.code==='Space')space=false;});
  stage.on('pointerdown',down);stage.on('pointermove',move);stage.on('pointerup pointercancel',up);
  observer=new ResizeObserver(()=>{if(!closed)void draw().catch(error=>status(error.message,true));});observer.observe($('[data-role=canvas]'));
 }
 function buttons(){
  if(!dialog)return;for(const b of dialog.querySelectorAll('[data-tool]')){b.classList.toggle('selected',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));}
  for(const b of dialog.querySelectorAll('[data-color]')){b.classList.toggle('selected',b.dataset.color===color);b.style.backgroundColor=b.dataset.color;b.setAttribute('aria-pressed',String(b.dataset.color===color));}
  $('[data-role=text-panel]').hidden=tool!=='text';$('[data-easel=undo]').disabled=!project?.canUndo||pending>0;
  const tooLong=$('[data-role=prompt]').value.length>4000,limit=$('[data-role=prompt-limit]');limit.hidden=!tooLong;limit.textContent=tooLong?'This message is '+$('[data-role=prompt]').value.length.toLocaleString()+' characters. Shorten the request to 4,000 characters before sending.':'';
  const running=listing.jobs.some(j=>j.status==='running');$('[data-easel=request]').disabled=!project||running||saveFailed||tooLong;$('[data-easel=stop]').hidden=!running;
  const backend=listing.backends.find(b=>b.id===$('[data-role=backend]').value);$('[data-role=billing]').textContent=backend?.billing==='subscription_usage'?'Uses your ChatGPT limits and credits. No image request is sent until you ask.':'Uses the selected image connection. No image request is sent until you ask.';$('[data-easel=connection]').hidden=backend?.connection!=='chatgpt';
  $('[data-role=proposal]').hidden=!preview;$('[data-easel=compare]').textContent=previewAfter?'Show before':'Show proposal';
  if(preview){const stale=project?.headId!==preview.baseId;$('[data-easel=accept]').disabled=stale||pending>0;$('[data-role=proposal-note]').textContent=stale?'The canvas changed while this was made. Restore its base or make another request.':preview.report?.changedPixels===0?'No pixels changed. Accepting is optional.':'Only your chosen work area will change.';}
  $('[data-role=boundary-label]').textContent=project?.doc.boundary?'Edit: drawn boundary':'Edit: whole canvas';
  $('[data-role=hint]').textContent=tool==='boundary'?'Draw a loop around the work area.':tool==='text'?'Write your text, then click to place it. Click existing text to edit or drag it.':'Sketch in a few colors. Hold Space to pan.';
 }
 async function refresh(){const chosen=$('[data-role=backend]').value;listing=await api.easel();const select=$('[data-role=projects]');select.innerHTML='<option value="">Saved projects</option>'+listing.projects.map(p=>`<option value="${e(p.id)}">${e(p.name)}</option>`).join('');select.value=project?.id??'';$('[data-role=backend]').innerHTML=listing.backends.map(b=>`<option value="${e(b.id)}">${e(b.label)}</option>`).join('');if(listing.backends.some(b=>b.id===chosen))$('[data-role=backend]').value=chosen;buttons();}
 async function setProject(p){if(project)promptDrafts.set(project.id,$('[data-role=prompt]').value);project=p;$('[data-role=prompt]').value=promptDrafts.get(p.id)??'';selectedText=null;textDirty=false;preview=null;zoom=1;pan={x:0,y:0};saveFailed=false;$('[data-role=name]').value=p.name;$('[data-role=text]').value='';$('[data-role=dimensions]').textContent=`${p.width} × ${p.height}`;await refresh();preview=listing.jobs.findLast(j=>j.projectId===p.id&&j.status==='ready')??null;buttons();await draw();status('Saved on this device');}
 function save(){
  if(!project)return Promise.resolve();const captured={id:project.id,name:project.name,doc:copy(project.doc),requestId:uid('save')};pending++;status('Saving…');buttons();
  const task=chain.then(async()=>{if(saveFailed)throw new Error('The previous save needs attention. Your drawing remains on screen.');const current=project;const result=await api.easel('/save',{...captured,version:current.version});if(project?.id===captured.id){project.version=result.version;project.headId=result.headId;project.history=result.history;project.assets=result.assets;project.canUndo=result.canUndo;}return result;});
  chain=task.catch(error=>{saveFailed=true;status(error.message,true);});return task.finally(()=>{pending--;buttons();if(!pending&&!saveFailed)status('Saved on this device');});
 }
 async function commitText(){if(textDirty){textDirty=false;await save();}}
 async function flush(){await commitText();await chain;if(saveFailed)throw new Error('A save needs attention. Keep this window open or save the marked picture before continuing.');}
 async function undo(){await flush();if(!project?.canUndo)return;const head=project.history.find(h=>h.id===project.headId);const next=await api.easel('/restore',{id:project.id,version:project.version,revisionId:head.parentId});await setProject(next);status('Undone');}
 async function draw(){
  if(!project||closed||gesture&&gesture.kind!=='pan')return;const epoch=++drawEpoch,el=$('[data-role=canvas]'),w=Math.max(1,el.clientWidth),h=Math.max(1,el.clientHeight);stage.size({width:w,height:h});
  const route=preview&&previewAfter?'/api/easel/proposal?'+new URLSearchParams({jobId:preview.id}):'/api/easel/image?'+new URLSearchParams({id:project.id,assetId:project.doc.assetId});const img=await image(route);if(epoch!==drawEpoch||closed)return;
  const scale=Math.min((w-30)/project.width,(h-30)/project.height)*zoom;view={scale,x:(w-project.width*scale)/2+pan.x,y:(h-project.height*scale)/2+pan.y};
  layer.destroyChildren();group=new window.Konva.Group({x:view.x,y:view.y,scaleX:scale,scaleY:scale,clip:{x:0,y:0,width:project.width,height:project.height}});layer.add(group);
  group.add(new window.Konva.Rect({width:project.width,height:project.height,fill:'#fff'}),new window.Konva.Image({image:img,width:project.width,height:project.height,listening:false}));
  if(!preview)for(const m of project.doc.marks){let node;
   if(m.type==='stroke')node=new window.Konva.Line({points:m.points,stroke:m.color,strokeWidth:m.size,lineCap:'round',lineJoin:'round',listening:false});
   else{node=new window.Konva.Text({x:m.x,y:m.y,text:m.text,fontSize:m.size,fontFamily:'Arial',fill:m.color,draggable:tool==='text',name:'text-mark',id:m.id});node.on('pointerdown',event=>{if(tool==='text'){event.cancelBubble=true;selectedText=m.id;$('[data-role=text]').value=m.text;}});node.on('dragend',()=>{const mark=project.doc.marks.find(v=>v.id===m.id);mark.x=Math.max(0,Math.min(project.width,node.x()));mark.y=Math.max(0,Math.min(project.height,node.y()));void save().then(draw).catch(error=>status(error.message,true));});}
   group.add(node);
  }
  if(project.doc.boundary)group.add(new window.Konva.Line({points:project.doc.boundary,closed:true,fill:'rgba(236,70,119,.06)',stroke:'#ec4677',strokeWidth:2/scale,dash:[7/scale,5/scale],listening:false}));layer.draw();
 }
 const point=()=>{const p=stage.getPointerPosition();return {x:Math.max(0,Math.min(project.width,(p.x-view.x)/view.scale)),y:Math.max(0,Math.min(project.height,(p.y-view.y)/view.scale))};};
 function down(event){
  if(!project||saveFailed||gesture||event.evt.button>1)return;const raw=stage.getPointerPosition();if(!raw)return;
  if(space||event.evt.button===1){gesture={kind:'pan',start:raw,pan:{...pan}};event.evt.preventDefault();return;}
  if(raw.x<view.x||raw.y<view.y||raw.x>view.x+project.width*view.scale||raw.y>view.y+project.height*view.scale)return;
  if(preview){preview=null;void draw();return;}
  const p=point();if(tool==='text'){void (async()=>{await commitText();const mark={id:uid('mark'),type:'text',x:p.x,y:p.y,size:Math.max(18,size*4),color,text:$('[data-role=text]').value||'Write here'};project.doc.marks.push(mark);selectedText=mark.id;$('[data-role=text]').value=mark.text;await save();await draw();$('[data-role=text]').focus();})().catch(error=>status(error.message,true));return;}
  const line=new window.Konva.Line({points:[p.x,p.y,p.x,p.y],stroke:tool==='boundary'?'#ec4677':color,strokeWidth:tool==='boundary'?2/view.scale:size,lineCap:'round',lineJoin:'round',listening:false});group.add(line);gesture={kind:tool,points:[p.x,p.y],line};event.evt.target.setPointerCapture?.(event.evt.pointerId);event.evt.preventDefault();
 }
 function move(event){if(!gesture||!project)return;if(gesture.kind==='pan'){const p=stage.getPointerPosition();pan={x:gesture.pan.x+p.x-gesture.start.x,y:gesture.pan.y+p.y-gesture.start.y};void draw();return;}const p=point();if(Math.hypot(p.x-gesture.points.at(-2),p.y-gesture.points.at(-1))<1)return;if(gesture.points.length>=6000)return;gesture.points.push(p.x,p.y);gesture.line.points(gesture.points);layer.batchDraw();event.evt.preventDefault();}
 function up(){if(!gesture||!project)return;const g=gesture;gesture=null;if(g.kind==='pan')return;const points=simplifyPoints(g.points,1.5);if(g.kind==='boundary'){if(points.length<6||Math.abs(polygonArea(points))<4){status('Draw a loop around an area, then release.',true);void draw();return;}project.doc.boundary=points;}else{if(points.length===2)points.push(...points);project.doc.marks.push({id:uid('mark'),type:'stroke',points,color,size});}void save().then(draw).catch(error=>status(error.message,true));}
 async function poll(){if(closed)return;try{await refresh();if(project){const job=listing.jobs.findLast(j=>j.projectId===project.id);if(job?.status==='ready'&&job.id!==preview?.id){preview=job;previewAfter=true;buttons();await draw();status('A proposal is ready. Compare it before accepting.');}if(job&&['failed','cancelled','interrupted'].includes(job.status))status(job.problem??'Image stopped.',true);}}catch(error){status(error.message,true);}clearTimeout(timer);if(!closed&&listing.jobs.some(j=>j.status==='running'))timer=setTimeout(()=>void poll(),900);}
 async function download(route,name){const res=await sessionFetch(route);if(!res.ok){const error=await res.json();throw new Error(error.error);}const url=URL.createObjectURL(await res.blob()),a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'-');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 async function exportProject(){
  try{await flush();return download('/api/easel/export?'+new URLSearchParams({id:project.id}),canvasName()+'.easel.json');}
  catch(error){
   if(!saveFailed)throw error;
   // A failed workspace save must not trap the user's still-visible marks.
   const bundle=await api.easel('/export?'+new URLSearchParams({id:project.id}));
   const h={id:uid('revision'),parentId:bundle.project.headId,requestId:uid('recovery'),at:new Date().toISOString(),label:'Unsaved drawing recovered by export',jobId:null,doc:copy(project.doc)};
   bundle.project.history.push(h);bundle.project.headId=h.id;bundle.project.version++;bundle.project.name=project.name;
   const url=URL.createObjectURL(new Blob([JSON.stringify(bundle)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='Easel-recovery.easel.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
   status('Recovery copy exported. The workspace save still needs attention.',true);
  }
 }
 async function close(){await flush();closed=true;opening++;clearTimeout(timer);space=false;gesture=null;dialog.close();}
 return {
  async open({prompt}={}){if(!dialog)bind();await flush();closed=false;const epoch=++opening;dialog.showModal();await refresh();if(epoch!==opening)return;if(prompt!==undefined){await setProject(await api.easel('/create',{name:'From message',image:null,requestId:uid('create')}));$('[data-role=prompt]').value=prompt;promptDrafts.set(project.id,prompt);buttons();$('[data-role=prompt]').focus();status('Edit this request, then ask when ready.');}else if(!project){const p=listing.projects[0];await setProject(p?await api.easel('/project?'+new URLSearchParams({id:p.id})):await api.easel('/create',{name:'Untitled',image:null,requestId:uid('create')}));}else await draw();await poll();},
  flush, get unsaved(){return pending>0||saveFailed||textDirty;}, close,
 };
}
