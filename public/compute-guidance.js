// Guidance belongs to the operation, not the size or name of the chat model.
// No green hardware verdict or price estimate is inferred from a saved setup.
export function computeGuidance(kind) {
  if (kind === 'images') return '<aside class="notice compute-guidance"><strong>Image generation needs extra computing power</strong><p>Requirements depend on the image model, picture size and number of pictures. It can use substantial graphics memory and slow other local models sharing the same GPU.</p><p class="field-help">A connection check does not load a model, measure image speed, or confirm that this computer has enough memory. Start with a small, single-picture job when generation is available.</p></aside>';
  if (kind === 'dreams') return '<aside class="notice compute-guidance"><strong>Dream training needs extra computing power</strong><p>Training can take substantial memory, disk space and time. Requirements depend on the base model and training recipe; being able to chat with a model does not establish that this computer can train it.</p><p class="field-help">Review where a Dream will run, its expected resource use and any spending limit before starting. Image generation is a separate feature.</p></aside>';
  throw new Error('Choose images or dreams for compute guidance.');
}
