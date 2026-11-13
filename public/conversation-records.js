// The same saved records the user sees, including one original group prompt.
export const discardedTaskIds=state=>new Set((state?.deskWork?.events??[]).filter(e=>e.kind==='task.discarded'&&e.detail.source==='human_ui').map(e=>e.taskId));
export function unsentRequestFailures(state,batchId){const discarded=discardedTaskIds(state);return (state.deskWork?.tasks??[]).filter(t=>t.batchId===batchId&&t.status==='failed'&&!t.exchangeId&&!discarded.has(t.id));}
export function conversationMessages(state, chatId) {
  const discarded=discardedTaskIds(state);
  const requests=new Set((state.exchanges??[]).filter(e=>e.request?.deskTaskId).map(e=>e.id));
  const messages=(state.messages??[]).filter(m=>m.chatId===chatId&&!(m.role==='user'&&requests.has(m.exchangeId)));
  const groups=(state.deskWork?.batches??[]).filter(b=>{
    if(b.chatId!==chatId||!b.original&&!b.selectedImages?.length)return false;
    const tasks=state.deskWork.tasks.filter(t=>t.batchId===b.id);
    return !tasks.length||!tasks.every(t=>t.status==='failed'&&!t.exchangeId&&discarded.has(t.id));
  }).map(b=>({
    id:b.id,chatId:b.chatId,role:'user',content:b.original,createdAt:b.createdAt,kind:'note',deskBatch:true,selectedImages:b.selectedImages,
    originTaskId:b.originTaskId??null,
    originChair:b.originTaskId?state.deskWork.tasks.find(t=>t.id===b.originTaskId)?.label:null,
  }));
  return [...messages,...groups].sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??''));
}

export function conversationMessage(state,id) {
  const record=state.messages?.find(m=>m.id===id)??state.deskWork?.batches.find(b=>b.id===id);
  return record?conversationMessages(state,record.chatId).find(m=>m.id===id):null;
}
