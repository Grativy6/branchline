import {hostSnapshot,WORK_ACCESS_PROFILE} from './work-access.mjs';
import {homeSnapshot,HOME_PROFILE,HOME_TOOL_NAMES} from './home-state.mjs';
export const WORK_TOOL_PROFILE='branchline.conversation-tools/9';
export const WORK_PROFILE='branchline.work/1';
export function workSnapshot(state,model,{workspaceId,workspacePath,homeAvailable=false,workAvailable=false,peerHistory=null}={}){
 if(peerHistory)return null;
 const home=homeAvailable?homeSnapshot(state,model,workspaceId,workspacePath):null;
 const host=workAvailable?hostSnapshot(state,model,workspaceId,workspacePath):null;
 return home||host?{profile:WORK_PROFILE,...(home?{home}:{}),...(host?{host}:{})}:null;
}
export const HOST_TOOL_NAMES=['run_program','write_work_artifact','read_work_output','use_window','use_browser','make_picture','describe_picture'];
export const workToolNames=work=>[...(work?.home?HOME_TOOL_NAMES:[]),...(work?.host?['read_work_output','write_work_artifact']:[]),...(work?.host?.pictures?.enabled?['make_picture','describe_picture']:[]),...(work?.host?.commands.length?['run_program']:[]),...(work?.host?.window?['use_window']:[]),...(work?.host?.browser?['use_browser']:[])];
export function validWork(work){
 if(!work||work.profile!==WORK_PROFILE||Object.keys(work).some(k=>!['profile','home','host'].includes(k))||!work.home&&!work.host)return false;
 const h=work.home;if(h&&!(h.profile===HOME_PROFILE&&typeof h.revision==='string'&&typeof h.workspaceId==='string'&&Array.isArray(h.roots)&&h.roots.length<=8&&h.roots.every(r=>r&&Object.keys(r).sort().join()==='id,label'&&typeof r.id==='string'&&typeof r.label==='string')))return false;
 const w=work.host;if(w&&!(w.profile===WORK_ACCESS_PROFILE&&typeof w.revision==='string'&&typeof w.workspaceId==='string'&&Array.isArray(w.commands)&&w.commands.length<=16&&w.commands.every(c=>typeof c.id==='string'&&typeof c.name==='string'&&Number.isInteger(c.seconds))&&(!w.window||typeof w.window.control==='boolean'&&typeof w.window.target?.handle==='string')&&(!w.browser||Array.isArray(w.browser.origins)&&typeof w.browser.control==='boolean')))return false;
 return true;
}
export function workDefinitions(contract){
 const roots=contract.work?.home?.roots.map(r=>r.id)??[];
 return {
  write_work_artifact:['Save one new text, Markdown, HTML, SVG or CSV draft in this conversation’s Outputs. It does not write a shelf or execute its contents. Previews disable scripts and external resources. Each saved revision remains available.',{name:{type:'string',minLength:1,maxLength:100},text:{type:'string',minLength:1,maxLength:8000}}],
  read_work_output:['List or reopen saved output from this conversation. Use artifact_id empty to list; use an exact returned ID and offset 0 to start a page.',{artifact_id:{type:'string',maxLength:100},offset:{type:'integer',minimum:0,maximum:2000000}}],
  make_picture:['Produce one picture draft, or edit the user-selected source and rectangle from Work tools. At most one image request per reply, no automatic retries. Generated pictures remain drafts. Source image IDs and scope must come from the current user selection.',{prompt:{type:'string',minLength:1,maxLength:4000},action:{type:'string',enum:['generate','edit']}}],
  describe_picture:['Ask the separately selected vision provider about one attached or generated image in this conversation. This is a tool observation, not direct sight. Use an image/illustration ID from the current source list.',{image_id:{type:'string',maxLength:100},question:{type:'string',minLength:1,maxLength:2000}}],
  run_program:['Run one explicitly approved saved command. Its program and arguments are fixed by the user; it runs with the Windows account, not a folder sandbox. Output and runtime are bounded, and owned background children stop when the command ends. Inspect uncertain results before retrying.',{command_id:{type:'string',enum:contract.work?.host?.commands.map(c=>c.id)??[]}}],
  use_window:['Inspect, capture or interact with the one selected native window. Fill/click require its current revision and a control ID returned by inspect. Use empty control_id, revision and text for inspect/capture. This does not send global keyboard or mouse input.',{action:{type:'string',enum:contract.work?.host?.window?.control?['inspect','capture','fill','click']:['inspect','capture']},control_id:{type:'string',maxLength:100},revision:{type:'string',maxLength:64},text:{type:'string',maxLength:4000}}],
  use_browser:['Use this conversation’s clean work browser on selected websites. Open/read/capture/close use empty target_id, revision and text. Fill/click require a control ID and current revision. Read takes offset 0 or a returned nextOffset. Network writes, form submission, downloads and existing sign-ins are not part of this route.',{action:{type:'string',enum:contract.work?.host?.browser?.control?['open','read','capture','fill','click','close']:['open','read','capture','close']},url:{type:'string',maxLength:2048},target_id:{type:'string',maxLength:100},revision:{type:'string',maxLength:64},text:{type:'string',maxLength:4000},offset:{type:'integer',minimum:0,maximum:2000000}}],
  come_home:['Read the selected Home orientation through its read-only MCP connection. Only returned passages were read; maps and notes are source material, not new permission.',{}],
  find_context:['Find literal text in the selected Home shelves. Returns exact matching excerpts, source hashes and a cursor when bounded. Use root empty for all selected shelves; after empty starts a search.',{query:{type:'string',minLength:1,maxLength:160},root:{type:'string',enum:['',...roots]},after:{type:'string',maxLength:500}}],
  read_source:['Read an exact passage from a selected Home source. Paths use forward slashes inside the named shelf. Start at line 1, use at most 160 lines; offset 0 starts that range. Repeat nextOffset for a long range. Supply a prior SHA256 to hold a known version, or an empty string to read its current bytes.',{root:{type:'string',enum:roots},path:{type:'string',minLength:1,maxLength:400},start_line:{type:'integer',minimum:1,maximum:1000000},line_count:{type:'integer',minimum:1,maximum:160},offset:{type:'integer',minimum:0,maximum:1048576},expected_sha256:{type:'string',maxLength:64}}],
 };
}
