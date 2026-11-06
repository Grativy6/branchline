export const NAV_HELP = 'Nav helps your agent find relevant work: README.md introduces the place, MAP.md shows routes, and TEMP.md supplies the episode-journal template. Receipt archives keep the journals and supporting records, with useful resolutions and open questions linked from the front.';
export const NAV_LABEL = 'Allow your agent to read, write, and edit the Nav system.';
export const NAV_TOOLS = Object.freeze(['nav_read','nav_journal','nav_update']);
export const NAV_ARCHIVES = Object.freeze(['receipt-archives','receipt-archive','receipt archive','receipts','archive']);
export const navDocument = name => /^(README|MAP|TEMP)\.md$/i.test(name);
export const navArchive = name => NAV_ARCHIVES.includes(name.toLowerCase());
export function navRelative(value) {
  if(typeof value!=='string'||value.length>180)throw new Error('Nav: use a bounded relative path.');
  const parts=value ? value.split('\\') : [];
  if(parts.some(p=>!p||p==='.'||p==='..'||/[<>:"/|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)))throw new Error('Nav: use an ordinary relative path within the selected location.');
  if(parts.filter(navArchive).length>1)throw new Error('Nav: archives are terminal; no archive beneath an archive.');
  return parts;
}
export const navFrozen = relative => (Array.isArray(relative)?relative:navRelative(relative)).some(p=>/^(before[-_]|snapshot(?:[-_]|$)|frozen(?:[-_]|$)|navigation-before-|ancestry[_ -]read[_ -]only$)/i.test(p)||['.git','node_modules','package-guides','repository origins','south-slope-v1'].includes(p.toLowerCase()));
export function navFileAllowed(relative, frontDoor=false, write=false) {
  if(write&&navFrozen(relative))return false;
  const parts=navRelative(relative), name=parts.at(-1), at=parts.findIndex(navArchive);
  if(!name)return false;
  if(frontDoor && !(parts.length===1||parts.length===2&&at===0))return false;
  if(navDocument(name))return at<0 || at===parts.length-2 && name.toLowerCase()!=='temp.md';
  return !write && at>=0 && at===parts.length-2 && /\.(md|txt|json)$/i.test(name);
}
