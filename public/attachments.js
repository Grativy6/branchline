// One chooser for supported attachments; original bytes still pass through the
// existing image and UTF-8 validators before they can be sent.
export async function attachmentKind(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const text = String.fromCharCode(...bytes);
  const webp = text.startsWith('RIFF') && text.slice(8) === 'WEBP';
  if (png || jpeg || webp || /\.(png|jpe?g|webp)$/i.test(file.name)) return 'image';
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return 'text';
  if (file.type?.startsWith('image/')) throw new Error('Choose a still PNG, JPEG or WebP picture.');
  if (/\.(pdf|docx)$/i.test(file.name)) return 'text';
  if (/\.(doc|xlsx?|pptx?|zip|exe|dll)$/i.test(file.name) || file.type === 'application/pdf') {
    throw new Error('This file type is not supported here yet. Choose a picture, UTF-8 text, or source-code file.');
  }
  return 'text';
}

export function createAttachmentPicker({ selection, filePicker, imagePicker, changed, reportError }) {
  const button = document.getElementById('configure-model');
  const input = document.getElementById('file-input');
  const composer = document.getElementById('composer-form');
  let busy = false, pickerChatId;
  async function add(files, chatId, origin) {
    if (busy || !chatId || !files?.length) return;
    busy = true; changed();
    try {
      const selected = [];
      for (const file of Array.from(files)) selected.push({ file, kind: await attachmentKind(file) });
      if (selected.filter(f => f.kind === 'text').length > 1) throw new Error('Choose one text file at a time; pictures can accompany it.');
      const pictures = selected.filter(f => f.kind === 'image').map(f => f.file);
      if (imagePicker.selected(chatId).length + pictures.length > 4) throw new Error('Choose up to four pictures for this reply.');
      for (const item of selected.filter(f => f.kind === 'text')) await filePicker.addFile(item.file, chatId);
      if (pictures.length) await imagePicker.addFiles(pictures, chatId, origin);
    } catch (error) { reportError(error.message); }
    finally { input.value = ''; busy = false; changed(); }
  }
  button.addEventListener('click', () => {
    if (button.disabled) return;
    pickerChatId = selection().chat?.id;
    if (pickerChatId) { input.value = ''; input.click(); }
  });
  input.addEventListener('change', () => void add(input.files, pickerChatId, 'pick'));
  composer.addEventListener('paste', event => {
    if (button.disabled || !event.clipboardData?.files.length) return;
    event.preventDefault(); void add(event.clipboardData.files, selection().chat?.id, 'paste');
  });
  composer.addEventListener('dragover', event => { if (!button.disabled && event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  composer.addEventListener('drop', event => {
    if (button.disabled || !event.dataTransfer?.files.length) return;
    event.preventDefault(); void add(event.dataTransfer.files, selection().chat?.id, 'drop');
  });
  return { render(chat, working) { button.disabled = !chat || working || busy || filePicker.busy || imagePicker.busy; } };
}
