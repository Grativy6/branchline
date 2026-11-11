export const DREAM_FOCI = Object.freeze({ conversation: 'Conversation flow', workflow: 'Workflow' });
export const DREAM_ACTIVE = new Set(['queued','preparing','waiting','loading','training','exporting','pausing','suspending','stopping']);
export const DREAM_FINISHED = new Set(['ready','stopped','failed']);
export const dreamTraining = state => state.dreamTraining ?? { version:1, settings:{preparerModelId:null}, notes:[], choices:[], runs:[], schedules:[], portraits:[], adoptions:[] };
export function dreamNotes(state, personalId) {
  const d=dreamTraining(state), latest=new Map();
  for(const note of d.notes)latest.set(note.noteId,note);
  return [...latest.values()].filter(n=>!n.removed&&(!n.personalId||n.personalId===personalId)).map(n=>{
    const choice=d.choices.findLast(c=>c.noteId===n.noteId&&c.personalId===personalId);
    const lastUse=d.runs.findLast(r=>r.personalId===personalId&&r.status==='ready'&&r.items.some(i=>i.revisionId===n.id)),used=!!lastUse;
    return {...n,included:choice?(choice.included&&(!used||choice.at>lastUse.finishedAt)):!used,used,rehearsalAllowed:choice?.included!==false};
  });
}
export const currentDreamRun=(state,personalId)=>dreamTraining(state).runs.findLast(r=>r.personalId===personalId&&!DREAM_FINISHED.has(r.status))??null;
export const latestDreamRun=(state,personalId)=>dreamTraining(state).runs.findLast(r=>r.personalId===personalId)??null;
export const dreamPortrait=(state,personalId)=>dreamTraining(state).portraits.findLast(p=>p.personalId===personalId)??null;
export function dreamPhase(run) {
  return run?.message || ({queued:'Waiting to start',preparing:'Preparing notes',waiting:'Waiting for local GPU',loading:'Loading training model',training:'Training',exporting:'Preparing the new generation',pausing:'Pausing…',suspending:'Saving progress…',suspended:'Suspended',interrupted:'Interrupted · progress kept',stopping:'Stopping…',stopped:'Stopped',failed:'Could not finish',ready:'New generation ready'}[run?.status]??'Ready');
}
