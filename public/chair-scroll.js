export function createChairScroll(container) {
  let list=null;
  const update=()=>{
    if(!list?.isConnected)return;
    const max=list.scrollWidth-list.clientWidth,left=container.querySelector('[data-chair-scroll="left"]'),right=container.querySelector('[data-chair-scroll="right"]');
    for(const [button,visible] of [[left,max>1&&list.scrollLeft>1],[right,max>1&&list.scrollLeft<max-1]]){
      if(!button)continue;
      if(!visible&&document.activeElement===button)list.focus({preventScroll:true});
      button.hidden=!visible;
    }
  };
  const observer=new ResizeObserver(update);
  container.addEventListener('click',event=>{
    const button=event.target.closest('[data-chair-scroll]');if(!button||!list)return;
    list.scrollBy({left:(button.dataset.chairScroll==='left'?-1:1)*Math.max(100,list.clientWidth*.75),behavior:'smooth'});
  });
  container.addEventListener('keydown',event=>{
    const row=event.target.closest('.visitor-row');if(!row||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const rows=[...list.querySelectorAll('.visitor-row')],index=rows.indexOf(row),next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowLeft'?-1:1)));
    event.preventDefault();rows[next].focus({preventScroll:true});rows[next].scrollIntoView({block:'nearest',inline:'nearest'});
  });
  window.addEventListener('resize',update);document.fonts?.addEventListener('loadingdone',update);
  window.addEventListener('pagehide',()=>{observer.disconnect();window.removeEventListener('resize',update);document.fonts?.removeEventListener('loadingdone',update);},{once:true});
  return {refresh(){
    const next=container.querySelector('.visitors-list');
    if(next!==list){
      const offset=list?.dataset.chatId===next?.dataset.chatId?list.scrollLeft:0;
      list?.removeEventListener('scroll',update);observer.disconnect();list=next;
      if(list){list.scrollLeft=offset;list.addEventListener('scroll',update,{passive:true});observer.observe(list);for(const row of list.children)observer.observe(row);}
    }
    update();
  }};
}
