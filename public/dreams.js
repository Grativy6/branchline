import { personalLabel } from './personal-label.js';
import { visiblePersonalModels, dreamOwner, personalDreams, dreamOutcome } from './dream-records.js';
import { computeGuidance } from './compute-guidance.js';

/* Reviewing history and choosing the Home model never starts training. */
const e = (value = '') => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export function recentDreamParticipant(state = {}) {
  const personalIds = new Set((state.personalParticipants || []).map(p => p.id));
  // Exchanges are already in append order. Inspect their small author records,
  // not message bodies, the journal, or a model's interpretation of its identity.
  const turns = state.exchanges || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const speaker = turns[i].speaker;
    if (speaker?.seat === 'personal' && personalIds.has(speaker.participantId)) return dreamOwner(state,speaker.participantId);
  }
  return null;
}

export function dreamsCard(state = {}, participantId) {
  const participants = visiblePersonalModels(state);
  const participant = participants.find(p => p.id === dreamOwner(state,participantId));
  const last = personalDreams(state,participant?.id).at(-1);
  const lastLabel = last ? `${last.occurredAt ? new Date(last.occurredAt).toLocaleDateString() : 'Date not recorded'} · ${dreamOutcome(state,last)}` : 'Not recorded in this app';
  const model = (state.models || []).find(m => m.id === participant?.connections?.at(-1)?.modelId);
  const generation = participant?.generations?.find(g => g.id === participant.currentGenerationId);
  const options = participants.map(p => `<option value="${e(p.id)}" ${p.id === participant?.id ? 'selected' : ''}>${e(personalLabel(p))}</option>`).join('');
  const modelDetail = participant
    ? `<p class="dream-model-name">${e(model?.name || 'Connection unavailable')}</p>
       <p class="dream-model-meta">${generation ? 'Current model connection' : 'Generation not recorded'}</p>
       ${generation ? `<details class="dream-model-details"><summary>Model details</summary><dl><dt>Base</dt><dd>${e(generation.baseIdentity)}</dd><dt>Generation</dt><dd>${e(generation.id)}</dd></dl></details>` : ''}`
    : `<p class="dream-model-meta">${participants.length ? 'Choose a personal model for a future manual Dream.' : 'Add a personal model to give Dream a starting point.'}</p>`;
  return `<section class="dreams-section" aria-labelledby="home-dreams-heading">
    <div class="home-section-heading dreams-heading"><h2 id="home-dreams-heading" class="home-section-title">Dreams</h2><span class="dream-development">Under development</span></div>
    <div class="dream-card">
      <div class="dream-art"><img src="/assets/dream-sprout.svg" alt="" width="148" height="148"><button type="button" class="dream-start" disabled aria-describedby="dream-availability">Start Dreaming</button></div>
      <div class="dream-timing"><dl class="dream-timeline"><div><dt>Last Dream recorded</dt><dd>${e(lastLabel)}</dd></div><div><dt>Next scheduled Dream</dt><dd>Scheduling coming later</dd></div></dl><button type="button" class="dream-review-button" data-action="dream-review" data-id="${e(participant?.id||'')}" ${participant?'':'disabled'}>Review Dreams</button></div>
      <div class="dream-personal"><label for="dream-personal-select">Personal model</label>
        <select id="dream-personal-select" aria-describedby="dream-selection-hint" ${participants.length ? '' : 'disabled'}><option value="" ${participant ? '' : 'selected'}>Choose a personal model</option>${options}</select>
        ${modelDetail}<p id="dream-selection-hint" class="dream-model-meta">For a manual cycle. Schedules will keep their own model.</p>
        ${participants.length ? '' : '<button type="button" class="text-button" data-action="library" data-id="personal">My Models</button>'}
      </div>
    </div>
    <div class="dream-footer"><p id="dream-availability">A little room to grow. Training and scheduling are being built. Training may need substantial memory and time.</p><button type="button" class="quiet-button" data-action="dream-prepare">Prepare a Dream</button><button type="button" class="quiet-button" data-action="dream-about">About Dream <span aria-hidden="true">↗</span></button></div>
  </section>`;
}

export function dreamAbout() {
  return `<div class="dream-about">
    <div class="dream-about-intro"><img src="/assets/dream-sprout.svg" width="100" height="100" alt=""><div><span class="dream-development">Under development</span><p>Room to grow between conversations.</p></div></div>
    <p>Dream is being built to help your personal model learn from experiences you choose. Your conversations stay readable as the model grows.</p>
    <ol class="dream-steps"><li><strong>Choose what can contribute.</strong> Select useful exchanges, corrections and distinctions.</li><li><strong>Prepare a new generation.</strong> Review the material, where training will run and its limits before a job starts.</li><li><strong>Compare and choose.</strong> Keep your current model or adopt the candidate between exchanges, with an earlier generation available to return to.</li></ol>
    <h3>Two ways to Dream</h3><p><strong>Manual cycles</strong> will start with your most recently used personal model. You can easily choose another.</p>
    <p><strong>Scheduled cycles</strong> will keep the model and timing you saved until you explicitly change the schedule. Switching models or starting a manual Dream will not rewrite that choice.</p>
    <p class="dream-about-status">Review Dreams keeps your recorded history, sources and notes. You can organize earlier model entries after reviewing their association. Training and scheduling are not running in this preview.</p>
    ${computeGuidance('dreams')}
    <div class="dialog-footer"><button type="button" class="primary-button" data-action="close-dialog">Got it</button></div>
  </div>`;
}
