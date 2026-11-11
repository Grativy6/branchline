// The same saved records the user sees, including one original group prompt.
export function conversationMessages(state, chatId) {
  const requests=new Set((state.exchanges??[]).filter(e=>e.request?.deskTaskId).map(e=>e.id));
  const messages=(state.messages??[]).filter(m=>m.chatId===chatId&&!(m.role==='user'&&requests.has(m.exchangeId)));
  const groups=(state.deskWork?.batches??[]).filter(b=>b.chatId===chatId&&(b.original||b.selectedImages?.length)).map(b=>({
    id:b.id,chatId:b.chatId,role:'user',content:b.original,createdAt:b.createdAt,kind:'note',deskBatch:true,selectedImages:b.selectedImages,
    originChair:b.originTaskId?state.deskWork.tasks.find(t=>t.id===b.originTaskId)?.label:null,
  }));
  return [...messages,...groups].sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??''));
}

export function conversationMessage(state,id) {
  const record=state.messages?.find(m=>m.id===id)??state.deskWork?.batches.find(b=>b.id===id);
  return record?conversationMessages(state,record.chatId).find(m=>m.id===id):null;
}
