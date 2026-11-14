import {conversationMaterialScopes,mergeMaterialScopes,checkMaterialScope} from './material-scope.mjs';
import {digest} from './integrity.mjs';
import {chairRoster} from '../public/chair-roster.js';
import {HAT_OPENING,HAT_TEMPLATE,hatHead,findHat,deskMemory,memoryHead,memoryChoice,threadHead,activeThreads} from '../public/hats.js';
import {returnRecords} from './return-records.mjs';

export const RETURN_MAP_PROFILE='branchline.return-map/1';
const rowsCache=new WeakMap(),revisionCache=new WeakMap(),PAGE=12;
const readPage=(body,offset)=>{if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Choose a non-negative source offset.');return {text:body.slice(offset,offset+6000),nextOffset:offset+6000<body.length?offset+6000:null,totalCharacters:body.length};};
const labelAuthor=a=>a?.name??a?.author??'Recorded author';
const hatName=h=>h?.displayName??hatHead(h)?.name??'Hat';
const slim=row=>({source:row.source,title:row.title,kind:row.kind,at:row.at,author:row.author,revision:row.revision??'',...(row.status?{status:row.status}:{})});

// Cache derived routes against immutable collection identities. Original bodies
// remain referenced, not copied into the catalogue or into every return map.
function indexPart(collection,key,build){
  if(!collection)return {rows:[],bySource:new Map()};
  if(!Object.isFrozen(collection)){const rows=build(collection),bySource=new Map();for(const row of rows){bySource.set(row.source,row);if(row.base)bySource.set(row.base,row);}return {rows,bySource};}
  let cached=rowsCache.get(collection);if(!cached)rowsCache.set(collection,cached=new Map());
  if(!cached.has(key)){const rows=build(collection),bySource=new Map();for(const row of rows){bySource.set(row.source,row);if(row.base)bySource.set(row.base,row);}cached.set(key,{rows,bySource});}
  return cached.get(key);
}
export function sourceIndex(s){
  const rr=returnRecords(s),w=s.deskWork;
  let order=revisionCache.get(w?.events??{});if(!order){order=new Map((w?.events??[]).map((e,i)=>[e.detail?.revision,i]));if(w?.events&&Object.isFrozen(w.events))revisionCache.set(w.events,order);}
  const parts=[
    indexPart(s.messages,'messages',rows=>rows.map(m=>({kind:'message',source:`message:${m.chatId}:${m.id}`,title:`${m.role==='user'?'User':m.modelLabel??'Chair'} · ${m.createdAt}`,at:m.createdAt,author:m.role==='user'?'User':m.modelLabel??'Recorded chair',chatId:m.chatId,id:m.id,exchangeId:m.exchangeId,record:m,sources:[]}))),
    indexPart(w?.artifacts,'artifacts',rows=>rows.flatMap(a=>a.revisions.map(v=>({kind:'artifact',source:`artifact:${a.chatId}:${a.id}:${v.id}`,base:`artifact:${a.chatId}:${a.id}`,title:a.title,at:v.at,author:v.author,chatId:a.chatId,id:a.id,revision:v.id,order:order.get(v.id)??0,record:v,sources:v.sources??[]})))),
    indexPart(w?.drawers,'drawers',rows=>rows.flatMap(d=>d.notes.flatMap(n=>n.revisions.map(v=>({kind:'drawer',source:`drawer:${d.chatId}:${d.chairId}:${encodeURIComponent(n.name)}:${v.id}`,base:`drawer:${d.chatId}:${d.chairId}:${encodeURIComponent(n.name)}`,title:n.name,at:v.at,author:v.author,chatId:d.chatId,chairId:d.chairId,revision:v.id,order:order.get(v.id)??0,record:v,sources:[]}))))),
    indexPart(w?.tasks,'tasks',rows=>rows.map(t=>({kind:'task',source:`task:${t.chatId}:${t.id}`,title:t.content.slice(0,120),at:t.endedAt??t.createdAt,author:t.originTaskId?w.tasks.find(p=>p.id===t.originTaskId)?.label??'Recorded chair':t.automatic||t.scheduled?'Branchline':'You',chatId:t.chatId,chairId:t.chairId,id:t.id,status:t.status,record:{id:t.id,chairId:t.chairId,assignment:t.content,assignedTo:t.label,status:t.status,exchangeId:t.exchangeId??null,error:t.error??null},sources:[]}))),
    indexPart(w?.events,'desk_events',rows=>rows.map(e=>({kind:'desk_event',source:`desk_event:${e.chatId}:${e.id}`,title:e.kind,at:e.at,author:e.author?.chair??e.author??e.chairId,chatId:e.chatId,chairId:e.visibility==='drawer'?e.chairId:null,id:e.id,record:e,sources:[]}))),
    indexPart(w?.goals,'goals',rows=>rows.flatMap(g=>g.revisions.map(v=>({kind:'goal',source:`goal:${g.chatId}:${g.id}:${v.id}`,base:`goal:${g.chatId}:${g.id}`,title:v.text?.slice(0,120)??'Goal',at:v.at??v.createdAt,author:'You',chatId:g.chatId,id:g.id,revision:v.id,record:v,sources:[]})))),
    indexPart(s.contextCarry?.records,'handoffs',rows=>rows.map(r=>({kind:'handoff',source:`handoff:${r.chatId}:${r.id}`,title:`Handoff through ${r.throughSourceId}`,at:r.createdAt,author:r.modelLabel??r.author,chatId:r.chatId,id:r.id,record:r,sources:[]}))),
    indexPart(rr.hats,'hats',rows=>rows.flatMap(h=>[
      ...h.revisions.map(v=>({kind:'hat',source:`hat:${h.id}:${v.id}`,base:`hat:${h.id}`,title:hatName(h),at:v.at,author:labelAuthor(v.author),hatId:h.id,revision:v.id,record:v,sources:v.sources})),
      ...h.notes.flatMap(n=>n.revisions.map(v=>({kind:'hat_note',source:`hat_note:${h.id}:${n.id}:${v.id}`,base:`hat_note:${h.id}:${n.id}`,title:v.title,at:v.at,author:labelAuthor(v.author),hatId:h.id,noteId:n.id,revision:v.id,record:v,sources:v.sources})))
    ])),
    indexPart(rr.memories,'memory',rows=>rows.flatMap(m=>[
      ...m.revisions.map(v=>({kind:'memory',source:`memory:${m.rootId}:${v.id}`,base:`memory:${m.rootId}`,title:'Desk MEMORY',at:v.at,author:labelAuthor(v.author),rootId:m.rootId,revision:v.id,record:v,sources:v.sources})),
      ...m.proposals.map(p=>({kind:'memory_proposal',source:`memory_proposal:${m.rootId}:${p.id}`,title:p.kind==='objection'?'Memory objection':'Memory proposal',at:p.at,author:labelAuthor(p.author),rootId:m.rootId,id:p.id,status:p.decisions.at(-1)?.status??'pending',record:p,sources:p.sources}))
    ])),
    indexPart(rr.threads,'threads',rows=>rows.flatMap(t=>t.revisions.map(v=>({kind:'thread',source:`thread:${t.chatId}:${t.id}:${v.id}`,base:`thread:${t.chatId}:${t.id}`,title:v.title,at:v.at,author:labelAuthor(v.author),chatId:t.chatId,rootId:t.rootId,id:t.id,revision:v.id,status:v.status,record:v,sources:[...v.sources,...v.watch,...v.evidence]})))),
    indexPart(rr.events,'return_events',rows=>rows.map(e=>({kind:'return_event',source:`return_event:${e.id}`,title:e.kind,at:e.at,author:labelAuthor(e.author),chatId:e.chatId,rootId:e.rootId,hatId:e.hatId,id:e.id,record:e,sources:e.detail.sources??[]}))),
    indexPart(rr.corrections,'corrections',rows=>rows.map(c=>({kind:'correction',source:`correction:${c.id}`,title:c.status,at:c.at,author:labelAuthor(c.author),chatId:c.chatId,rootId:c.rootId,id:c.id,record:c,sources:[c.target,...(c.replacement?[c.replacement]:[])]}))),
    indexPart(s.handoffs?.records,'receipts',rows=>rows.filter(r=>['operation.result','tool.answer'].includes(r.kind)).map(r=>({kind:'receipt',source:`receipt:${r.scope.chatId}:${r.id}`,title:r.detail.tool??r.kind,at:r.at,author:r.from,chatId:r.scope.chatId,id:r.id,record:r,sources:[]}))),
  ];
  return {parts,find(source){for(const part of parts){const row=part.bySource.get(source);if(row)return row;}return null;}};
}
function selected(s,chatId,selection){const chat=s.chats.find(c=>c.id===chatId),roster=chairRoster(s,chat),chair=selection?.chairSnapshot??[roster?.desk,...(roster?.visitors??[])].find(c=>c?.id===selection?.chairId)??roster?.desk;return {chat,root:s.roots.find(r=>r.id===chat?.rootId),chair,hat:findHat(s,chair?.hatId),memory:deskMemory(s,chat?.rootId)};}
function linkedRoots(s,ctx,index){
  const refs=new Set(),add=values=>{for(const value of values??[])refs.add(value);};
  if(ctx.hat){if(hatHead(ctx.hat).sourceBindingsRecorded!==false)add(hatHead(ctx.hat).sources);for(const note of ctx.hat.notes)if(note.revisions.at(-1).sourceBindingsRecorded!==false)add(note.revisions.at(-1).sources);}
  if(memoryChoice(ctx.memory).enabled){if(memoryHead(ctx.memory)?.sourceBindingsRecorded!==false)add(memoryHead(ctx.memory)?.sources);for(const proposal of ctx.memory.proposals)add(proposal.sources);}
  for(const thread of activeThreads(s,ctx.chat.id)){const v=threadHead(thread);add(v.sources);add(v.watch);add(v.evidence);}
  const queue=[...refs];for(let i=0;i<queue.length;i++){const row=index.find(queue[i]);for(const ref of row?.record.sourceBindingsRecorded===false?[]:row?.sources??[])if(!refs.has(ref)){refs.add(ref);queue.push(ref);}}
  return refs;
}
function permitted(row,ctx,linked,human=false){
  if(human)return true;
  if(row.hatId)return row.hatId===ctx.hat?.id||linked.has(row.source);
  if(row.kind==='memory'||row.kind==='memory_proposal')return row.rootId===ctx.root?.id&&memoryChoice(ctx.memory).enabled;
  if(row.kind==='return_event'&&row.record.kind.startsWith('memory.'))return row.rootId===ctx.root?.id&&memoryChoice(ctx.memory).enabled;
  if(row.kind==='desk_event'&&row.chairId)return row.chatId===ctx.chat?.id&&row.chairId===ctx.chair?.id;
  if(row.kind==='drawer')return row.chatId===ctx.chat?.id&&row.chairId===ctx.chair?.id;
  return row.chatId===ctx.chat?.id||linked.has(row.source)||linked.has(row.base);
}
export function sourceStanding(s,source,index=sourceIndex(s)){
  const rows=[],seen=new Set(),walk=[source];
  while(walk.length){const ref=walk.pop();if(seen.has(ref))continue;seen.add(ref);for(const c of returnRecords(s).corrections)if(c.target===ref)rows.push({...c,relation:ref===source?'direct':'depends_on',source:ref});const parent=index.find(ref);for(const link of parent?.record.sourceBindingsRecorded===false?[]:parent?.sources??[])walk.push(link);}
  return rows;
}
export function resolveReturnSource(s,chatId,selection,source,{human=false,disclosure=null}={}){
  const ctx=selected(s,chatId,selection),index=sourceIndex(s);if(!ctx.chat)throw new Error('Conversation not found.');
  const row=index.find(source);if(!row)throw new Error('This source route is unavailable. Its original reference is preserved.');
  if(!permitted(row,ctx,linkedRoots(s,ctx,index),human))throw new Error('That source is outside this chair’s Hat, shared memory and conversation routes.');
  if(!human&&row.chatId&&row.chatId!==chatId)disclosure?.(row.chatId,row);
  if(!human&&row.kind==='message'&&s.exchanges.find(e=>e.id===row.exchangeId)?.status==='pending')throw new Error('This reply is still running. Read its saved result after it completes.');
  return row;
}
export function readReturnSource(s,chatId,selection,{source,offset=0},options={}){
  const row=resolveReturnSource(s,chatId,selection,source,options),body=JSON.stringify(row.record,null,2),standing=sourceStanding(s,row.source);
  return {...slim(row),sourceBindingsRecorded:row.record.sourceBindingsRecorded!==false,standing:standing.slice(-12),standingCount:standing.length,...readPage(body,offset)};
}
export function searchReturnSources(s,chatId,selection,{query='',offset=0},human=false){
  if(typeof query!=='string'||query.length>200||!Number.isSafeInteger(offset)||offset<0)throw new Error('Use a short search and non-negative offset.');
  const ctx=selected(s,chatId,selection),index=sourceIndex(s),linked=linkedRoots(s,ctx,index),term=query.toLocaleLowerCase(),rows=[];
  for(const part of index.parts)for(const row of part.rows){if(!permitted(row,ctx,linked,human))continue;if(term&&!(row.title+' '+JSON.stringify(row.record)).toLocaleLowerCase().includes(term))continue;rows.push(row);}
  return {query,total:rows.length,offset,rows:rows.slice(offset,offset+PAGE).map(row=>({...slim(row),standing:sourceStanding(s,row.source,index)})),nextOffset:offset+PAGE<rows.length?offset+PAGE:null};
}
function currentRows(index,kind,condition){const latest=new Map();for(const part of index.parts)for(const row of part.rows)if(row.kind===kind&&condition(row))latest.set(row.base??row.source,row);return [...latest.values()].sort((a,b)=>(a.at??'').localeCompare(b.at??'')||(a.order??0)-(b.order??0));}
const preview=text=>text?.length>400?{opening:text.slice(0,200),ending:text.slice(-200),characters:text.length,complete:false}:{text:text??'',complete:true};
export function captureReturnAnchor(s,chatId){
  const chat=s.chats.find(c=>c.id===chatId),r=chairRoster(s,chat),memory=deskMemory(s,chat?.rootId);
  const index=sourceIndex(s),threads=activeThreads(s,chatId).map(t=>{const v=threadHead(t),candidates=new Map();for(const ref of [...v.watch,...v.sources]){const pinned=index.find(ref),current=pinned&&(pinned.base?index.find(pinned.base):pinned);if(!current||current.chatId!==chatId)continue;candidates.set(current.source,{...slim(current),hash:digest(current.record),...preview(current.record.text??JSON.stringify(current.record)),standing:sourceStanding(s,current.source,index).map(c=>({id:c.id,status:c.status,author:labelAuthor(c.author),reason:c.reason.slice(0,240)}))});}return {...v,id:t.id,revision:v.id,candidates:[...candidates.values()]};});
  return {profile:RETURN_MAP_PROFILE,chatId,rootId:chat?.rootId,at:new Date().toISOString(),materialScopes:conversationMaterialScopes(s,chatId),positions:{messages:s.messages.length,deskEvents:s.deskWork?.events.length??0,returnEvents:s.returnRecords?.events.length??0},memory:memory?{enabled:memoryChoice(memory).enabled,revision:memoryHead(memory)?.id??null,author:memoryChoice(memory).author}:null,chairs:[r.desk,...r.visitors].map(c=>({chairId:c.id,hatId:c.hatId??null,hatRevision:hatHead(findHat(s,c.hatId))?.id??null,coat:c.coat??null})),threads};
}
export function returnMap(s,chatId,selection){
  const ctx=selected(s,chatId,selection),index=sourceIndex(s),rr=returnRecords(s),chairId=ctx.chair?.id;
  const carry=s.contextCarry?.records.find(r=>r.id===s.contextCarry?.active?.[chatId]),window=s.contextCarry?.windows?.find(w=>w.id===s.contextCarry.working?.[chatId]);
  const maintenance=new Set((s.deskWork?.tasks??[]).filter(t=>t.memoryHandoff).map(t=>t.exchangeId));
  const previous=rr.supplies.findLast(p=>p.chatId===chatId&&p.chairId===chairId&&!maintenance.has(p.exchangeId)&&s.exchanges.find(e=>e.id===p.exchangeId)?.status==='completed');
  const start=previous?.positions??carry?.returnAnchor?.positions??{deskEvents:0,returnEvents:0};
  const ownTasks=(s.deskWork?.tasks??[]).filter(t=>t.chatId===chatId&&t.chairId===chairId);
  const task=ownTasks.findLast(t=>['preparing','running'].includes(t.status)),prior=ownTasks.findLast(t=>!t.memoryHandoff&&!['queued','waiting','preparing','running','stopping'].includes(t.status));
  const lastExchange=s.exchanges.findLast(e=>e.chatId===chatId&&e.speaker?.chairId===chairId&&!maintenance.has(e.id)&&e.status!=='pending'),lastReply=lastExchange&&s.messages.findLast(m=>m.exchangeId===lastExchange.id&&m.role==='assistant');
  const threads=activeThreads(s,chatId),threadRows=threads.map(t=>({...threadHead(t),id:t.id,revision:threadHead(t).id}));
  const refs=new Set([...(previous?.refs??[]),...threadRows.flatMap(t=>[...t.watch,...t.evidence,...t.sources])]);
  const thinking=new Set((s.deskWork?.events??[]).filter(e=>e.chatId===chatId&&e.chairId===chairId&&e.kind==='thinking.saved').flatMap(e=>e.detail.notes.map(n=>n.revision)));
  const artifacts=currentRows(index,'artifact',r=>r.chatId===chatId),notes=currentRows(index,'drawer',r=>r.chatId===chatId&&r.chairId===chairId&&!thinking.has(r.revision));
  const changes=new Map();let otherChanges=0;
  for(const event of (s.deskWork?.events??[]).slice(start.deskEvents)){
    if(event.chatId!==chatId)continue;
    const related=event.chairId===chairId||event.detail?.recipientChairId===chairId||/artifact/.test(event.kind)||refs.has(event.detail?.source);
    if(related){const key=event.detail?.artifactId??event.detail?.id??event.taskId??event.id;changes.delete(key);changes.set(key,{source:`desk_event:${chatId}:${event.id}`,kind:event.kind,author:event.author?.chair??event.author??event.chairId,at:event.at,recordId:key});}else otherChanges++;
  }
  for(const event of rr.events.slice(start.returnEvents)){
    if(event.kind==='source.read')continue;
    const related=event.hatId===ctx.hat?.id&&!!ctx.hat||event.rootId===ctx.root?.id&&event.kind.startsWith('memory.')&&memoryChoice(ctx.memory).enabled||event.chatId===chatId&&(event.kind.startsWith('thread.')||event.kind==='source.corrected'||event.kind==='conflict'||event.author?.chairId===chairId);
    if(related){const key=event.threadId??event.detail?.noteId??event.detail?.target??event.hatId??event.detail?.proposalId??event.rootId??event.id;changes.delete(key);changes.set(key,{source:`return_event:${event.id}`,kind:event.kind,author:labelAuthor(event.author),at:event.at,recordId:key});}else if(event.rootId===ctx.root?.id)otherChanges++;
  }
  const choice=memoryChoice(ctx.memory),memory=memoryHead(ctx.memory),head=hatHead(ctx.hat),hatNotes=ctx.hat?.notes??[];
  const selectedMemory=memory?.sources.filter(r=>threadRows.some(t=>[...t.watch,...t.evidence,...t.sources].includes(r)))??[];
  const slots={
    handoff:carry?{id:carry.id,through:carry.throughSourceId,at:carry.createdAt,source:`handoff:${chatId}:${carry.id}`,previous:carry.previousId?`handoff:${chatId}:${carry.previousId}`:null,window:window?.throughSourceId??null}:null,
    ownWork:{chairId,drawer:{count:notes.length,routes:notes.slice(-4).map(slim),returnNote:notes.length?{source:notes.at(-1).source,...preview(notes.at(-1).record.text)}:null},previous:prior?{source:`task:${chatId}:${prior.id}`,status:prior.status}:null,lastReply:lastReply?{source:`message:${chatId}:${lastReply.id}`,status:lastExchange.status,...preview(lastReply.content)}:null,threads:{count:threads.length,items:threadRows.slice(-6).map(t=>({id:t.id,title:t.title,status:t.status,criterion:t.criterion.slice(0,240),lookFor:t.lookFor.slice(0,240),source:`thread:${chatId}:${t.id}:${t.revision}`}))}},
    task:{source:task?`task:${chatId}:${task.id}`:null,goal:currentRows(index,'goal',r=>r.chatId===chatId).at(-1)?.source??null,artifacts:{count:artifacts.length,routes:artifacts.slice(-6).map(slim)}},
    memory:choice.enabled?{enabled:true,revision:memory?.id??null,source:memory?`memory:${ctx.root.id}:${memory.id}`:null,author:choice.author,authorHere:choice.author?.chatId===chatId&&choice.author?.chairId===chairId,pending:ctx.memory.proposals.filter(p=>!p.decisions.length||p.decisions.at(-1).status==='pending').length,selectedPassages:selectedMemory}: {enabled:false},
    hat:head?{id:ctx.hat.id,name:hatName(ctx.hat),revision:head.id,source:`hat:${ctx.hat.id}:${head.id}`,introTemplate:HAT_TEMPLATE,notesAllowed:ctx.chair.hatNotesAllowed!==false,introEditsAllowed:head.allowChairIntro,noteCount:hatNotes.length,notes:hatNotes.slice(-4).map(n=>({title:n.revisions.at(-1).title,source:`hat_note:${ctx.hat.id}:${n.id}:${n.revisions.at(-1).id}`}))}:null,
    changes:{sinceInput:previous?.id??null,sinceKind:'ordinary_work',matched:changes.size,items:[...changes.values()].sort((a,b)=>a.at.localeCompare(b.at)).slice(-6),otherDeskChanges:otherChanges},
    history:{read:'read_return_source',search:'read_return_map',searchArguments:{query:'',offset:0},coverage:'Displayed routes are a subset; search/index paging reopens the original records.'}
  };
  const collect=value=>{if(typeof value==='string'&&/^(hat|hat_note|memory|thread|task|artifact|drawer|handoff|message|receipt|goal|desk_event|return_event):/.test(value))refs.add(value);else if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')Object.values(value).forEach(collect);};collect(slots);
  const standing=[...refs].flatMap(r=>sourceStanding(s,r,index)).filter((v,i,a)=>a.findIndex(q=>q.id===v.id)===i);
  return {profile:RETURN_MAP_PROFILE,chatId,chairId,slots,standing:{count:standing.length,items:standing.slice(-6).map(c=>({source:`correction:${c.id}`,target:c.target,status:c.status,relation:c.relation,author:labelAuthor(c.author)}))},positions:{messages:s.messages.length,deskEvents:s.deskWork?.events.length??0,returnEvents:rr.events.length},refs:[...refs].filter(r=>index.find(r)).slice(-100)};
}
export function returnMaterialScopes(s,chatId,selection){
  const ctx=selected(s,chatId,selection);return mergeMaterialScopes(conversationMaterialScopes(s,chatId),hatHead(ctx.hat)?.materialScopes??[],...(ctx.hat?.notes.slice(-4)??[]).map(n=>n.revisions.at(-1).materialScopes??[]));
}
export function assertReturnDisclosure(s,chatId,model,selection,workspaceId,workspacePath,kind='reply'){for(const scope of kind==='reply'?returnMaterialScopes(s,chatId,selection):conversationMaterialScopes(s,chatId))checkMaterialScope(s,scope,model,{workspaceId,dataDir:workspacePath});}
export function suppliedMap(map){const {refs,...view}=map;return view;}
export function returnMessages(s,chatId,selection){
  const ctx=selected(s,chatId,selection),head=hatHead(ctx.hat),map=returnMap(s,chatId,selection),out=[];
  if(head)out.push({role:'user',content:HAT_OPENING+'\n\n'+head.intro});
  // The fixed slots replace the old excerpt-only restart map; the handoff text
  // itself remains in carryMessages and the source history is not rewritten.
  out.push({role:'user',content:'[Return map: recorded routes and current selections. Use read_return_source for an exact source and read_return_map to search/paginate.]\n'+JSON.stringify(suppliedMap(map))});
  return out;
}
export function recordReturnSupply(s,{chatId,selection,exchangeId,handoff,messages}){
  if(!selection?.chairId)return;
  const raw=messages.find(m=>m.content.startsWith('[Return map:'))?.content;
  if(!raw)return;
  const map=JSON.parse(raw.slice(raw.indexOf('\n')+1));
  s.returnRecords??={profile:'branchline.return-records/1',hats:[],memories:[],threads:[],events:[],supplies:[],corrections:[]};s.schemaVersion=Math.max(8,s.schemaVersion);
  const refs=new Set();const collect=v=>{if(typeof v==='string'&&/^(hat|hat_note|memory|thread|task|artifact|drawer|handoff|message|receipt|goal|desk_event|return_event):/.test(v))refs.add(v);else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};collect(map);
  s.returnRecords.supplies.push({id:'supply_'+exchangeId,at:new Date().toISOString(),chatId,chairId:selection.chairId,exchangeId,handoffRecordId:handoff.contextId,phase:'prepared',mapHash:digest(map),positions:map.positions,refs:[...refs],materialScopes:returnMaterialScopes(s,chatId,selection),hat:map.slots.hat?{id:map.slots.hat.id,revision:map.slots.hat.revision}:null,modelId:selection.modelId,coat:selection.coat??null});
}
