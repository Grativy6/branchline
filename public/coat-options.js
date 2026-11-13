// Current preferences live outside immutable instruction revisions.
export const DEFAULT_COAT_OPTIONS = Object.freeze({color:null,thinking:false,thinkingContextCharacters:4000});
export const STARTER_COLORS=Object.freeze({conversation:'#e6ba41',brainstorm:'#9c6ade',tutor:'#66a86d',assistant:'#5a8ed8',roleplay:'#ec4899',rival:'#e58a3b',redteam:'#d96363'});
export function coatPreferences(state,id){return Object.hasOwn(STARTER_COLORS,id)?{...DEFAULT_COAT_OPTIONS,color:STARTER_COLORS[id]}:state.coatOptions?.[id]??DEFAULT_COAT_OPTIONS;}
export function checkCoatOptions(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(DEFAULT_COAT_OPTIONS,k))
    || !(value.color===null||typeof value.color==='string'&&/^#[0-9a-f]{6}$/i.test(value.color))
    ||typeof value.thinking!=='boolean'||!Number.isInteger(value.thinkingContextCharacters)||value.thinkingContextCharacters<0||value.thinkingContextCharacters>16000)
    throw new Error('Choose a color, Thinking Coat setting, and a saved-note allowance from 0 to 16,000 characters.');
  return value;
}
export function messageCoatId(state,message){
  if(message.originTaskId)return state.deskWork?.tasks.find(t=>t.id===message.originTaskId)?.selection.coat?.ref?.id??null;
  if(message.role!=='assistant')return null;
  const turn=state.exchanges.find(e=>e.id===message.exchangeId);
  return turn?.harness?.ref?.id??turn?.harness?.preset?.id??null;
}
export function coatColorAttribute(state,id){const color=coatPreferences(state,id).color;return color&&/^#[0-9a-f]{6}$/i.test(color)?` data-coat-color="${color}"`:'';}
export function applyCoatColors(root){
  for(const card of [...(root.matches?.('[data-coat-color]')?[root]:[]),...root.querySelectorAll('[data-coat-color]')]){
    if(/^#[0-9a-f]{6}$/i.test(card.dataset.coatColor))card.style.setProperty('--coat-color',card.dataset.coatColor);
  }
}
