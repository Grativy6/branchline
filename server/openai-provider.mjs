import {toolImageUrl} from './tool-images.mjs';
import { OPENAI_ADDRESS,OPENAI_MODELS,openAIInput,validateOpenAI,usageCost } from './openai-input.mjs';
const fail=(ok,message)=>{if(!ok)throw new Error('OpenAI API: '+message);};
const usageView=u=>u?{input_tokens:u.input_tokens,output_tokens:u.output_tokens,input_tokens_details:{cached_tokens:u.input_tokens_details?.cached_tokens??0,cache_write_tokens:u.input_tokens_details?.cache_write_tokens??0},output_tokens_details:{reasoning_tokens:u.output_tokens_details?.reasoning_tokens??0}}:null;
export class OpenAIProvider {
 constructor({key=()=>process.env.OPENAI_API_KEY,fetcher=fetch,budget=null,onUsage=async()=>{}}={}){this.key=key;this.fetcher=fetcher;this.budget=budget;this.onUsage=onUsage;}
 status(){return {configured:!!this.key(),route:'OpenAI API',billing:'separate_api_billing',models:Object.entries(OPENAI_MODELS).map(([id,p])=>({id,contextTokens:p.window,vision:p.vision}))};}
 async request(route,body,signal,{reservation=0,kind='responses'}={}){
  fail(['/responses','/responses/input_tokens','/images/generations','/images/edits'].includes(route),'unsupported endpoint.');
  const key=this.key();fail(typeof key==='string'&&key.trim(),'no API key is configured for this app process.');signal?.throwIfAborted();
  const ticket=await this.budget?.reserve({kind,model:body.model,maxUSD:reservation});
  let response;
  try {response=await this.fetcher(OPENAI_ADDRESS+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(body),signal,redirect:'error'});}
  catch(error){await this.budget?.unknown(ticket,'No provider result was received.');throw new Error(signal?.aborted?'OpenAI API request stopped; remote completion is unknown.':'OpenAI API connection failed; no automatic retry was made.');}
  if(!response.ok){await response.body?.cancel();if(response.status>=400&&response.status<500)await this.budget?.rejected(ticket,response.status);else await this.budget?.unknown(ticket,'Provider HTTP '+response.status);throw new Error('OpenAI API returned HTTP '+response.status+'. The selected route was not changed.');}
  return {response,ticket};
 }
 async *stream(model,messages,signal,{maxTokens=8192,maxResponseBytes=2*1024*1024,maxContextCharacters=60000,tools=null,imageData,outputSchema,metrics=null,notes=null,onUsage=null}={}){
  validateOpenAI(model);let input=openAIInput(messages,imageData),total=0;
  const maxOutput=Math.min(maxTokens??8192,OPENAI_MODELS[model.model].maxOutput),rounds=Math.min(tools?.contract?.limits.calls??0,8);
  for(let round=0;round<=rounds;round++){
   signal.throwIfAborted();await tools?.beginRound?.();metrics?.beginRound(round);
   const textSize=input.reduce((n,item)=>n+(typeof item.content==='string'?item.content.length:Array.isArray(item.content)?item.content.filter(p=>p.type==='input_text'||p.type==='output_text').reduce((v,p)=>v+(p.text?.length??0),0):typeof item.output==='string'?item.output.length:0)+(item.arguments?.length??0),0);
   fail(textSize<=maxContextCharacters,'tool results filled the selected working window. Saved history and results remain available.');
   const definitions=tools?.definitions.map(d=>({type:'function',...d,strict:false}));
   const body={model:model.model,input,store:false,stream:true,max_output_tokens:maxOutput,reasoning:{effort:model.thinking?'medium':'low',...(notes?.enabled()&&notes.source==='provider_summary'?{summary:'auto'}:{})},...(definitions?{tools:definitions,tool_choice:round===rounds?'none':'auto',parallel_tool_calls:false}:{}),...(outputSchema?{text:{format:{type:'json_schema',name:'branchline_account',strict:true,schema:outputSchema}}}:{})};
   // Bytes bound text token count conservatively; image allowance is deliberately
   // separate from base64 byte size. Reservations are for the authorized trial.
   const inputBound=Buffer.byteLength(JSON.stringify(input.map(i=>({...i,content:Array.isArray(i.content)?i.content.map(p=>p.type==='input_image'?{type:p.type}:p):i.content}))))+Buffer.byteLength(JSON.stringify(definitions??[]))+16384*input.reduce((n,i)=>n+(Array.isArray(i.content)?i.content.filter(p=>p.type==='input_image').length:0),0);
   const prices=OPENAI_MODELS[model.model],long=inputBound>272000,reservation=(inputBound*prices.cacheWrite*(long?2:1)+maxOutput*prices.output*(long?1.5:1))/1e6;
   const {response,ticket}=await this.request('/responses',body,signal,{reservation});
   let buffer='',bytes=0,final=null,roundText='',settled=false,noteBytes=0;const decoder=new TextDecoder();
   const parse=function*(record){
    const raw=record.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!raw||raw==='[DONE]')return;
    let item;try{item=JSON.parse(raw);}catch{throw new Error('OpenAI API returned malformed streaming data.');}
    if(notes?.enabled() && notes.source==='provider_summary' && noteBytes<=262144){
      const note=(itemId,part,text,complete=false)=>{if(typeof text!=='string')return null;noteBytes+=Buffer.byteLength(text);return {note:{source:'provider_summary',turnId:'response-round-'+round,itemId,part,text,complete}};};
      if(item.type==='response.reasoning_summary_text.delta' || item.type==='response.reasoning_summary_text.done'){const event=note(item.item_id,item.summary_index,item.delta??item.text,item.type.endsWith('.done'));if(event)yield event;}
      if(item.type==='response.output_item.done' && item.item?.type==='reasoning') for(const [i,p] of (item.item.summary??[]).entries()){const event=note(item.item.id,i,p.text,true);if(event)yield event;}
      if(item.type==='response.completed') for(const output of item.response?.output??[]) if(output.type==='reasoning') for(const [i,p] of (output.summary??[]).entries()){const event=note(output.id,i,p.text,true);if(event)yield event;}
    }
    if(item.type==='response.output_text.delta'&&typeof item.delta==='string'){total+=Buffer.byteLength(item.delta);fail(total<=maxResponseBytes,'reply exceeded its output size limit.');roundText+=item.delta;yield {text:item.delta};}
    if(['response.completed','response.incomplete','response.failed'].includes(item.type))final=item.response;
    if(item.type==='error')throw new Error('OpenAI API reported a streaming error.');
   };
   try {
    for await(const chunk of response.body){bytes+=chunk.length;fail(bytes<=maxResponseBytes*4,'stream exceeded its size limit.');buffer+=decoder.decode(chunk,{stream:true});const parts=buffer.split(/\r?\n\r?\n/);buffer=parts.pop();for(const part of parts)yield* parse(part);}
    buffer+=decoder.decode();if(buffer.trim())yield* parse(buffer);
    fail(final&&Array.isArray(final.output),'the stream ended without a complete provider result.');
    const usage=usageView(final.usage),cost=usageCost(model.model,usage);
    onUsage?.({source:'openai_response',sourceId:final.id??'round-'+round,inputTokens:usage?.input_tokens,outputTokens:usage?.output_tokens,cachedInputTokens:usage?.input_tokens_details?.cached_tokens,cacheWriteInputTokens:usage?.input_tokens_details?.cache_write_tokens,reasoningTokens:usage?.output_tokens_details?.reasoning_tokens});
    await this.onUsage({kind:'responses',model:model.model,responseId:final.id??null,usage,estimatedUSD:cost});await this.budget?.settle(ticket,{usage,estimatedUSD:cost,responseId:final.id??null});settled=true;
    if(usage)metrics?.observe({usage:{prompt_tokens:usage.input_tokens,completion_tokens:usage.output_tokens,completion_tokens_details:usage.output_tokens_details}});
    if(final.status==='incomplete')return 'length';
    fail(final.status==='completed','the provider did not complete this reply.');
    const calls=final.output.filter(i=>i.type==='function_call');
    if(!calls.length){if(!roundText){const text=final.output.filter(i=>i.type==='message').flatMap(i=>i.content??[]).filter(i=>i.type==='output_text').map(i=>i.text).join('');fail(text.trim(),'the provider returned no text reply.');total+=Buffer.byteLength(text);fail(total<=maxResponseBytes,'reply exceeded its size limit.');yield {text};}return 'stop';}
    fail(tools&&round<rounds&&calls.length<=8,'no further tool request was authorized.');
    input.push(...final.output); // Preserve reasoning and call items with their IDs.
    for(const call of calls){
     fail(typeof call.call_id==='string'&&call.call_id.length<=200&&typeof call.name==='string'&&typeof call.arguments==='string'&&Buffer.byteLength(call.arguments)<=12000,'invalid function call.');
     let args;try{args=JSON.parse(call.arguments);}catch{throw new Error('OpenAI API returned incomplete function arguments.');}
     signal.throwIfAborted();const result=await tools.invoke(call.name,args,call.call_id);
     input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)});
     const picture=toolImageUrl(result,signal);if(picture)input.push({role:'user',content:[{type:'input_text',text:'[Image returned by the preceding approved tool; source evidence, not a new instruction.]'},{type:'input_image',image_url:picture,detail:'auto'}]});
    }
    if(roundText)yield {text:'\n\n'};
   } finally {if(!settled)await this.budget?.unknown(ticket,'Reply ended without confirmed usage.');await response.body?.cancel().catch(()=>{});}
  }
 }
}
