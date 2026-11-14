import {assertHomeDisclosure} from './home-state.mjs';
import {assertPcDisclosure} from './pc-permissions.mjs';
import {assertWorkDisclosure} from './work-access.mjs';
import {assertSketchDisclosure} from './sketches.mjs';
import {boundContext,contextAllowed} from './personal-context.mjs';
import {assertAgentDisclosure} from './agent-profiles.mjs';

// The same captured source scopes used by Pony Post. Counters freeze what had
// been encountered at the crossing; they do not classify or grade the text.
export function captureMaterialScope(s,chatId,agents=false){
  const rootId=s.chats.find(c=>c.id===chatId)?.rootId;
  const profiles=new Set((s.handoffs?.records??[]).filter(r=>r.kind==='context.to_model'&&r.scope.rootId===rootId&&r.detail.contextView?.personalContext).map(r=>r.detail.contextView.personalContext.profileId));
  for(const seat of ['personal','visiting']){const b=boundContext(s,chatId,seat);if(b)profiles.add(b.profileId);}
  return {chatId,homeArrivals:s.home?.arrivals.length??0,homeExposures:s.home?.exposures.length??0,pc:s.pcAccess?.exposures.length??0,work:s.workAccess?.exposures.length??0,sketch:s.sketchBook?.exposures.length??0,profiles:[...profiles],...(agents?{agentRecords:s.handoffs?.records.length??0}:{})};
}
export function checkMaterialScope(s,source,model,store){
  const view={...s,
    ...(s.home?{home:{...s.home,arrivals:s.home.arrivals.slice(0,source.homeArrivals),exposures:s.home.exposures.slice(0,source.homeExposures)}}:{}),
    ...(s.pcAccess?{pcAccess:{...s.pcAccess,exposures:s.pcAccess.exposures.slice(0,source.pc)}}:{}),
    ...(s.workAccess?{workAccess:{...s.workAccess,exposures:s.workAccess.exposures.slice(0,source.work)}}:{}),
    ...(s.sketchBook?{sketchBook:{...s.sketchBook,exposures:s.sketchBook.exposures.slice(0,source.sketch)}}:{}),
    ...(source.agentRecords!==undefined&&s.handoffs?{handoffs:{...s.handoffs,records:s.handoffs.records.slice(0,source.agentRecords)}}:{})};
  assertHomeDisclosure(view,source.chatId,model,store.workspaceId,store.dataDir);
  assertPcDisclosure(view,source.chatId,model,store.workspaceId,store.dataDir);
  assertWorkDisclosure(view,source.chatId,model,store.workspaceId,store.dataDir);
  assertSketchDisclosure(view,source.chatId,model,store.workspaceId);
  for(const id of source.profiles)if(!contextAllowed(s,id,model))throw new Error('This destination needs sharing access to the carried personal continuity.');
  if(source.agentRecords!==undefined)assertAgentDisclosure(view,source.chatId,model,null,'reply');
}
export function mergeMaterialScopes(...lists){
  const byChat=new Map();
  for(const s of lists.flat()){
    if(!s?.chatId)continue;const old=byChat.get(s.chatId);
    if(!old){byChat.set(s.chatId,structuredClone(s));continue;}
    for(const key of ['homeArrivals','homeExposures','pc','work','sketch','agentRecords'])if(s[key]!==undefined)old[key]=Math.max(old[key]??0,s[key]);
    old.profiles=[...new Set([...old.profiles,...s.profiles])];
  }
  return [...byChat.values()];
}
export function conversationMaterialScopes(s,chatId){
  if(!chatId)return [];
  return mergeMaterialScopes([captureMaterialScope(s,chatId,true)],
    ...(s.returnRecords?.supplies??[]).filter(p=>p.chatId===chatId).map(p=>p.materialScopes??[]),
    ...(s.returnRecords?.events??[]).filter(e=>e.chatId===chatId&&e.kind==='source.read').map(e=>e.detail.materialScopes??[]));
}
