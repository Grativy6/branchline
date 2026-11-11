import {conversationMessage} from './conversation-records.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function messageGear(id) {
  return `<button type="button" class="message-options-button" data-message-options="${escape(id)}" aria-label="Message options" title="Message options" aria-haspopup="menu" aria-controls="message-options-menu" aria-expanded="false"><span aria-hidden="true"></span></button>`;
}

export function messageActions(state,id) {
  const m=conversationMessage(state,id);if(!m)return [];
  const exchange=state.exchanges?.find(x=>x.id===m.exchangeId),approach=m.kind==='parallel'?state.parallel?.jobs.find(x=>x.id===m.parallelEpisodeId):null;
  const options=[{label:'Save as Dream note',dream:'mark-message',id:m.id},{label:'Send with Pony Post',action:'pony-compose',id:m.id}];
  if(m.role==='assistant'&&(approach||exchange)?.status!=='pending')options.push({label:'Save as sketch',action:'save-sketch',id:m.id},{label:'Save as memory',action:'save-memory',id:m.id});
  if(m.content?.trim())options.push({label:'Make image',action:'message-image',id:m.id});
  if(m.role==='assistant')options.push({label:'Details',action:approach?'parallel-details':'reply-details',id:approach?.id??m.id});
  const records=(state.handoffs?.records??[]).filter(r=>r.taskId===(m.parallelEpisodeId??m.exchangeId)&&r.kind==='operation.result');
  for(const r of records){
    if(r.detail.tool==='write_sketch'&&r.detail.result?.ok)options.push({label:'Open saved sketch · '+r.detail.result.value.title,action:'open-sketch',id:r.detail.result.value.id});
    if(r.detail.tool==='propose_personal_note'&&r.detail.result?.value?.saved)options.push({label:'Memory updated · View / Undo',action:'view-memory',id:r.detail.result.value.profile});
  }
  if(exchange&&state.workAccess?.artifacts?.some(a=>a.taskId===exchange.id))options.push({label:'Open outputs',action:'work-outputs'});
  return options;
}

export function createMessageActions({getState,getChatId,container}) {
  const menu=document.createElement('div');menu.id='message-options-menu';menu.className='message-options-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Message options');menu.setAttribute('popover','manual');menu.hidden=true;document.body.append(menu);
  let current=null,markup='';
  const trigger=()=>current&&[...container.querySelectorAll('[data-message-options]')].find(b=>b.dataset.messageOptions===current.id);
  const items=()=>[...menu.querySelectorAll('button')];
  function close(focus=false){const button=trigger();current=null;button?.setAttribute('aria-expanded','false');if(menu.matches(':popover-open'))menu.hidePopover();menu.hidden=true;if(focus)button?.focus({preventScroll:true});}
  function position(){
    const button=trigger();if(!button||!button.getClientRects().length){close();return;}
    const anchor=button.getBoundingClientRect(),bounds=container.getBoundingClientRect();
    if(anchor.bottom<Math.max(bounds.top,0)||anchor.top>Math.min(bounds.bottom,innerHeight)){close();return;}
    const size=menu.getBoundingClientRect(),gap=6,edge=8;
    const top=anchor.bottom+gap+size.height<=innerHeight-edge?anchor.bottom+gap:Math.max(edge,anchor.top-gap-size.height);
    menu.style.left=Math.max(edge,Math.min(anchor.left,innerWidth-size.width-edge))+'px';menu.style.top=top+'px';
  }
  function refresh(){
    if(!current)return;if(getChatId()!==current.chatId||!trigger()){close();return;}
    const options=messageActions(getState(),current.id);if(!options.length){close();return;}
    const next=options.map(o=>`<button type="button" role="menuitem" ${o.dream?`data-dream-job="${escape(o.dream)}"`:`data-action="${escape(o.action)}"`} ${o.id?`data-id="${escape(o.id)}"`:''}>${escape(o.label)}</button>`).join('');
    if(next!==markup){const focused=menu.contains(document.activeElement),index=items().indexOf(document.activeElement);menu.innerHTML=markup=next;if(focused)items()[Math.max(0,index)]?.focus({preventScroll:true});}
    trigger().setAttribute('aria-expanded','true');position();
  }
  function open(button,keyboard=false,last=false){
    close();current={id:button.dataset.messageOptions,chatId:getChatId()};menu.hidden=false;refresh();if(!current)return;menu.showPopover();position();if(keyboard)items().at(last?-1:0)?.focus({preventScroll:true});
  }
  document.addEventListener('pointerdown',event=>{
    if(event.target.closest('[data-message-options]')||menu.contains(event.target))event.preventDefault();
    else if(current)close();
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-message-options]');
    if(button){event.preventDefault();current?.id===button.dataset.messageOptions?close():open(button,event.detail===0);return;}
    if(current&&menu.contains(event.target)&&event.target.closest('button'))close();
  },true);
  document.addEventListener('keydown',event=>{
    const button=event.target.closest('[data-message-options]');
    if(button&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(button,true,event.key==='ArrowUp');return;}
    if(!current)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);return;}
    if(!menu.contains(event.target))return;
    const choices=items(),index=choices.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowDown'?1:choices.length-1))%choices.length;choices[next]?.focus();}
    if(event.key==='Tab')close(true);
  },true);
  window.addEventListener('resize',()=>{if(current)position();});
  document.addEventListener('scroll',()=>{if(current)position();},true);
  return {refresh,close,get isOpen(){return Boolean(current);}};
}
