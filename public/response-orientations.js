// Base orientation is separate from a chair's saved Coat and executable pockets.
export const ORIENTATIONS = Object.freeze({
  play: "Lean into playful conversation, imagination and exploration. Let the user's invitations give it direction, taking up a task when they give you one.",
  create: "Meet the user with your ordinary voice and judgment, letting the exchange find its shape. Follow emerging invitations to play, explore or build.",
  work: "Prioritize carrying the user's intended task through to completion. Keep conversation focused, with room to appreciate humor, warmth and discoveries along the way.",
});

export const MODE_LABELS = Object.freeze({ play: 'Play', create: 'Create', work: 'Work', chat: 'Chat', build: 'Build' });

// Resolve current choices without rewriting legacy selections or exchange records.
export function effectiveOrientation(value) {
  if (value === undefined || value === 'chat') return 'create';
  if (value === 'build') return 'work';
  return value;
}

export function recordedOrientationLabel(value) {
  return value === null ? 'Finis Solutus instructions' : MODE_LABELS[value] ?? 'Not recorded in this earlier reply';
}
