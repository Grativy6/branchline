const immutable = new WeakSet(), sharedCopies = new WeakSet();
export const isImmutable = value => value !== null && typeof value === 'object' && immutable.has(value);
const plain = value => Array.isArray(value) || value && [Object.prototype,null].includes(Object.getPrototypeOf(value));

// JSON strings are already immutable. Do not repeatedly copy their bytes, or
// clone append-only receipt bodies just to edit a composer or add a new turn.
export function cloneJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (sharedCopies.has(value)) return value;
  if (!plain(value)) return structuredClone(value);
  const result=Array.isArray(value)?[]:{};
  for(const key of Object.keys(value))Object.defineProperty(result,key,{value:cloneJson(value[key]),writable:true,enumerable:true,configurable:true});
  return result;
}
export function freezeAndShare(value, previous, keepRoot=false) {
  if(value===null||typeof value!=='object')return value;
  if(isImmutable(value))return value;
  if(!plain(value))throw new Error('Saved state must contain JSON values.');
  const keys=Object.keys(value), prior=previous&&typeof previous==='object'?previous:null;
  let same=!!prior&&Array.isArray(value)===Array.isArray(prior)&&keys.length===Object.keys(prior).length;
  for(const key of keys){
    const child=freezeAndShare(value[key],prior?.[key]);
    if(!prior||!Object.hasOwn(prior,key)||child!==prior[key])same=false;
    if(child!==value[key])Object.defineProperty(value,key,{value:child,writable:true,enumerable:true,configurable:true});
  }
  if(same&&!keepRoot&&isImmutable(prior))return prior;
  Object.freeze(value);immutable.add(value);return value;
}
export function shareReceiptCopies(state) {
  for(const item of [...(state.handoffs?.records??[]),...(state.handoffs?.heldOutputs??[])])if(isImmutable(item))sharedCopies.add(item);
  return state;
}
