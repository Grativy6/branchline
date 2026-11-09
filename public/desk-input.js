export function inputRevision(state, taskId) {
  return state.deskWork?.events?.findLast(e => e.kind === 'input.revised' && e.taskId === taskId) ?? null;
}
export const taskInput = (state, task) => inputRevision(state, task.id)?.detail.text ?? task.content;
export const inputDelivery = (state, taskId) => state.deskWork?.events?.findLast(e => e.kind === 'input.delivery' && e.taskId === taskId)?.detail ?? null;
export const isDeliveredInput = (state, taskId) => ['accepted', 'uncertain'].includes(inputDelivery(state, taskId)?.state);
