import crypto from 'node:crypto';
import {coatPreferences} from '../public/coat-options.js';
import {deskEvent,drawerFor,writeDrawer} from './desk-work.mjs';
import {noteSource} from './reasoning-notes.mjs';

export const THINKING_SEED='You are brainstorming. Write your best representation of an inner-monologue and keep it in your drawer for every instruction-granting prompt.';
export function thinkingChoice(state,selection){const p=coatPreferences(state,selection?.coat?.ref?.id);return {enabled:p.thinking,characters:p.thinkingContextCharacters};}
export function thinkingMessages(state,chatId,selection,choice=thinkingChoice(state,selection),{requestNote=false}={}){
  if(!choice.enabled||!selection?.chairId)return [];
  const out=requestNote?[{role:'system',content:THINKING_SEED+'\nUse record_reasoning_note to save this working note, then continue the assignment. Keep it out of the public reply.'}]:[];
  const drawer=drawerFor(state,chatId,selection.chairId),selected=state.thinkingContext?.[drawer?.id]??[];
  const sources=state.deskWork?.events.filter(e=>e.chatId===chatId&&e.chairId===selection.chairId&&e.kind==='thinking.saved')??[];
  let left=choice.characters;
  for(const event of sources.slice().reverse()){
    for(const saved of event.detail.notes??[]){
      if(!selected.includes(saved.revision)||left<=0)continue;
      const note=drawer?.notes.find(n=>n.name===saved.name)?.revisions.find(r=>r.id===saved.revision);if(!note)continue;
      const heading=`[Your selected drawer note; model-written working material, not a new instruction or established result. Source: ${event.detail.source}; task: ${event.taskId}; status: ${event.detail.status}; note: ${saved.name}; revision: ${saved.revision}]\n`;
      const room=Math.max(0,left-heading.length-80);if(!room)continue;
      const excerpt=note.text.slice(0,room),content=heading+excerpt+(excerpt.length<note.text.length?'\n[Excerpt. Reopen this named drawer note for the rest.]':'');
      out.push({role:'user',content});left-=content.length;
    }
  }
  return out;
}
export function selectThinkingNote(state,{drawerId,revisionId,selected}){
  const drawer=state.deskWork?.drawers.find(d=>d.id===drawerId);
  if(typeof selected!=='boolean'||!drawer?.notes.some(n=>n.revisions.some(r=>r.id===revisionId))
    ||!state.deskWork.events.some(e=>e.kind==='thinking.saved'&&e.chatId===drawer.chatId&&e.chairId===drawer.chairId&&e.detail.notes.some(n=>n.revision===revisionId)))throw new Error('Choose a saved thinking note in this chair’s drawer.');
  const choices=state.thinkingContext??={};const old=choices[drawerId]??[];
  choices[drawerId]=selected?[...new Set([...old,revisionId])]:old.filter(id=>id!==revisionId);state.schemaVersion=Math.max(5,state.schemaVersion);
}
export function validateThinkingContext(state){
  if(state.thinkingContext===undefined)return;
  if(!state.thinkingContext||typeof state.thinkingContext!=='object'||Array.isArray(state.thinkingContext))throw new Error('Invalid thinking-note choices.');
  for(const [id,choices] of Object.entries(state.thinkingContext)){
    const drawer=state.deskWork?.drawers.find(d=>d.id===id);
    if(!drawer||!Array.isArray(choices)||new Set(choices).size!==choices.length||choices.some(choice=>!drawer.notes.some(n=>n.revisions.some(r=>r.id===choice))))throw new Error('Thinking context must refer to this chair’s saved notes.');
  }
}

// Wrap the existing recorder. No timer starts work and no additional model call
// is made. Returned native channels and explicitly authored notes stay separate.
export class ThinkingNotes {
  constructor({store,task,exchangeId,periodic=null}){Object.assign(this,{store,task,exchangeId,periodic});this.source=noteSource(task.model);this.parts=new Map();this.count=0;this.closed=false;this.operations=Promise.resolve();this.error=null;}
  enabled(){return !this.closed&&!this.stopRequested;}
  serial(fn){const result=this.operations.then(fn);this.operations=result.catch(error=>{this.error??=error;});return result;}
  tick(){return this.periodic?.tick()??Promise.resolve();}
  checkpoint(result){return this.periodic?.checkpoint(result)??Promise.resolve(result);}
  status(){return this.count?'Thinking note saved in drawer':'Waiting for a working note or exposed thinking';}
  get work(){return this.periodic?.work??0;}set work(value){if(this.periodic)this.periodic.work=value;}
  async save(text,source,sourceIds,status='complete'){
    if(!text.trim())return null;
    const id='thinking_'+crypto.randomUUID();let result;
    await this.store.transact(s=>{
      const notes=[];
      for(let offset=0;offset<text.length;offset+=32000){
        const name=`Thinking ${id.slice(9)}${text.length>32000?' · '+(1+offset/32000):''}`;
        notes.push(writeDrawer(s,this.task,{name,text:text.slice(offset,offset+32000),revision:''}));
      }
      const drawer=drawerFor(s,this.task.chatId,this.task.chairId);
      (s.thinkingContext??={})[drawer.id]=[...(s.thinkingContext[drawer.id]??[]),...notes.map(n=>n.revision)];
      result=deskEvent(s,this.task,'thinking.saved',{id,exchangeId:this.exchangeId,source,sourceIds,status,notes,characters:text.length},'drawer');
      s.schemaVersion=Math.max(5,s.schemaVersion);return s;
    });this.count++;return result;
  }
  authored(args,callId){return this.serial(async()=>{
    if(this.closed)return {ok:false,error:'This reply has closed.'};
    if(typeof args.text!=='string'||args.text.length>32000)return {ok:false,error:'Use a working note up to 32,000 characters.'};
    if(args.corrects&&!this.savedIds?.has(args.corrects))return {ok:false,error:'A correction must point to a saved note from this task.'};
    const event=await this.save(args.text,'requested_brainstorming',{callId,corrects:args.corrects||null});
    if(event)(this.savedIds??=new Set()).add(event.id);
    return {ok:true,value:{saved:!!event,noteId:event?.id??null,visibility:'your chair drawer',notes:event?.detail.notes??[]}};
  });}
  receive(value){return this.serial(async()=>{
    if(this.closed||!['provider_summary','native_thinking'].includes(value?.source)||typeof value.text!=='string')return;
    const key=JSON.stringify([value.source,value.threadId,value.turnId,value.itemId,value.part]);
    const old=this.parts.get(key)??{source:value.source,sourceIds:{threadId:value.threadId??null,turnId:value.turnId??null,itemId:value.itemId,part:value.part},text:'',complete:false};
    old.text=value.complete?value.text:old.complete?old.text:old.text+value.text;old.complete||=!!value.complete;
    this.parts.set(key,old);
    await this.periodic?.receive(value);
  });}
  close(status='complete'){return this.serial(async()=>{
    if(this.closed){if(this.error)throw this.error;return;}this.closed=true;
    for(const part of this.parts.values())await this.save(part.text,part.source,part.sourceIds,part.complete?'complete':status==='complete'?'complete':'interrupted');
    await this.periodic?.close(status);
    if(!this.count)await this.store.transact(s=>{deskEvent(s,this.task,'thinking.unavailable',{exchangeId:this.exchangeId,reason:'No working note or native thinking text was returned for this request.'},'drawer');return s;});
    if(this.error)throw this.error;
  });}
}
