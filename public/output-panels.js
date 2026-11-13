import {applyCoatColors} from './coat-options.js';
const sourceMarkup=new WeakMap();
let rememberOutputs=()=>{},restoreOutputs=()=>{};
// Keep unchanged message nodes (and a reader's selection) while other chairs
// update. Only the changed cards are replaced.
export function replaceOutputContent(target,html){
 const selection=window.getSelection(),anchorBefore=selection?.anchorNode,saved=[];
 if(selection&&!selection.isCollapsed&&target.contains(selection.anchorNode)&&target.contains(selection.focusNode)){
  for(const [node,offset] of [[selection.anchorNode,selection.anchorOffset],[selection.focusNode,selection.focusOffset]]){
   const el=node.nodeType===1?node:node.parentElement,owner=el.closest('[data-output-owner],[data-message-id],[data-task]'),code=el.closest('.output-panel'),body=code?.querySelector('code,pre')??el.closest('.message-body,.markdown-body');
   if(!owner||!body||!body.contains(node)){saved.length=0;break;}
   const range=document.createRange();range.selectNodeContents(body);range.setEnd(node,offset);
   saved.push({owner:owner.dataset.outputOwner??owner.dataset.messageId??owner.dataset.task,panel:code?.dataset.outputKey,offset:range.toString().length});
  }
 }
 for(const panel of target.querySelectorAll('.output-panel'))rememberOutputs(panel);
 const template=document.createElement('template');template.innerHTML=html;
 const incoming=template.content.firstElementChild?.matches('.message-list')?template.content.firstElementChild:null,current=target.querySelector(':scope > .message-list');
 const parent=incoming&&current?current:target,next=incoming&&current?incoming:template.content;
 const key=node=>node.nodeType===1?(node.dataset.messageId??node.dataset.task??node.dataset.outputOwner):null;
 const existing=new Map([...parent.children].filter(n=>key(n)).map(n=>[key(n),n]));let cursor=parent.firstChild;
 for(const fresh of [...next.childNodes]){
  const old=existing.get(key(fresh)),markup=fresh.outerHTML??fresh.textContent;
  const node=old&&sourceMarkup.get(old)===markup?old:fresh;
  if(node!==cursor)parent.insertBefore(node,cursor);
  sourceMarkup.set(node,markup);cursor=node.nextSibling;
 }
 while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
 // Seed nested message nodes on the first render.
 for(const node of target.querySelectorAll('[data-message-id],[data-task]'))if(!sourceMarkup.has(node))sourceMarkup.set(node,node.outerHTML);
 restoreOutputs(target);
 if(saved.length===2&&!anchorBefore?.isConnected){
  const endpoints=saved.map(p=>{
   const owner=[...target.querySelectorAll('[data-output-owner],[data-message-id],[data-task]')].find(n=>(n.dataset.outputOwner??n.dataset.messageId??n.dataset.task)===p.owner);
   const body=p.panel!==undefined?owner?.querySelector(`[data-output-key="${CSS.escape(p.panel)}"] code,[data-output-key="${CSS.escape(p.panel)}"] pre`):owner?.querySelector('.message-body,.markdown-body');
   if(!body)return null;const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);let n,last,left=p.offset;
   while(n=walker.nextNode()){last=n;if(left<=n.textContent.length)return [n,left];left-=n.textContent.length;}return last?[last,last.textContent.length]:null;
  });
  if(endpoints.every(Boolean))selection.setBaseAndExtent(...endpoints[0],...endpoints[1]);
 }
}
// Presentation state only. Original message/tool bytes remain in their records.
export function installOutputPanels({toast=()=>{},reportError=()=>{}}={}){
 const saved=new Map();
 const key=panel=>{
  const owner=panel.closest('[data-output-owner],[data-message-id],[data-task],.desk-artifact,#dialog,#context-dialog');
  if(!owner)return null;
  const id=owner.dataset.outputOwner??owner.dataset.messageId??owner.dataset.task??(owner.id?owner.id+':'+(owner.querySelector('h2,h3')?.textContent??''):owner.querySelector('strong')?.textContent);
  return id+':'+panel.dataset.outputKey;
 };
 function remember(panel){const id=key(panel);if(id){saved.set(id,{open:panel.open,scroll:panel.querySelector('.output-scroll')?.scrollTop??0});if(saved.size>600)saved.delete(saved.keys().next().value);}}
 function restore(root){
  applyCoatColors(root);
  for(const panel of [...(root.matches?.('.output-panel')?[root]:[]),...(root.querySelectorAll?.('.output-panel')??[])]){
   const data=saved.get(key(panel));if(data){panel.open=data.open;const box=panel.querySelector('.output-scroll');if(box)box.scrollTop=data.scroll;}
  }
  // Existing tool-result and recorded-input readers already use inert <pre>.
  const selector='.tool-result pre,pre.tool-result,pre.tool-result-text,#dialog pre,.context-dialog pre';
  for(const pre of [...(root.matches?.(selector)?[root]:[]),...(root.querySelectorAll?.(selector)??[])]){
   if(pre.tagName!=='PRE'||pre.closest('.output-panel')||pre.textContent.length<=1000&&pre.textContent.split('\n').length<=10)continue;
   const panel=document.createElement('details');panel.className='output-panel';panel.dataset.outputKey='tool-'+[...pre.parentElement.querySelectorAll('pre')].indexOf(pre);
   const summary=document.createElement('summary');summary.innerHTML='<span>Recorded output</span><button type="button" class="text-button" data-output-copy>Copy</button><span class="output-expand">Expand</span><span class="output-collapse">Collapse</span>';
   const box=document.createElement('div');box.className='output-scroll';box.tabIndex=0;box.setAttribute('aria-label','Recorded output');
   pre.replaceWith(panel);panel.append(summary,box);box.append(pre);restore(panel);
  }
 }
 rememberOutputs=remember;restoreOutputs=restore;
 document.addEventListener('toggle',event=>{if(event.target.matches?.('.output-panel'))remember(event.target);},true);
 document.addEventListener('scroll',event=>{if(event.target.matches?.('.output-scroll'))remember(event.target.closest('.output-panel'));},true);
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-output-copy]');if(!button)return;event.preventDefault();event.stopPropagation();
  const code=button.closest('.output-panel').querySelector('code,pre');
  void navigator.clipboard.writeText(code.textContent).then(()=>toast('Complete output copied'),error=>reportError(error.message));
 });
 const observer=new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node.nodeType===1)restore(node);});
 observer.observe(document.body,{childList:true,subtree:true});restore(document.body);
 window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
}
