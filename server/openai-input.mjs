import { mediaUrl } from './model-media.mjs';
export const OPENAI_ADDRESS='https://api.openai.com/v1';
export const OPENAI_MODELS=Object.freeze({
 'gpt-6-astra':{window:1050000,maxOutput:128000,input:10,cache:1,cacheWrite:12.5,output:50,vision:true},
 'gpt-6.1-sol':{window:1050000,maxOutput:128000,input:2,cache:.1,cacheWrite:2.5,output:10,vision:true},
 'gpt-6-sol':{window:1050000,maxOutput:128000,input:2,cache:.2,cacheWrite:2.5,output:10,vision:true},
 'gpt-6-luna':{window:1050000,maxOutput:128000,input:.1,cache:.01,cacheWrite:.125,output:.5,vision:true},
});
export function openAIInput(messages,imageData){
 return messages.map(m=>({role:m.role,content:m.images?.length?[{type:'input_text',text:m.content},...m.images.map(ref=>({type:'input_image',image_url:mediaUrl(ref,imageData),detail:'auto'}))]:m.content}));
}
export function validateOpenAI(model){
 if(model.runtime!=='openai'||model.baseUrl!==OPENAI_ADDRESS||(model.inputFormat??'chat')!=='chat')throw new Error('OpenAI API uses the fixed official HTTPS connection and chat input.');
 if(!OPENAI_MODELS[model.model])throw new Error('Choose a supported OpenAI API model from this connection’s catalogue.');
}
export function usageCost(model,usage){
 const p=OPENAI_MODELS[model];if(!p||!usage)return null;
 const input=usage.input_tokens,output=usage.output_tokens,cached=usage.input_tokens_details?.cached_tokens??0,write=usage.input_tokens_details?.cache_write_tokens??0;
 if(![input,output,cached,write].every(x=>Number.isSafeInteger(x)&&x>=0)||cached+write>input)return null;
 const long=input>272000;return ((input-cached-write)*p.input*(long?2:1)+cached*p.cache*(long?2:1)+write*p.cacheWrite*(long?2:1)+output*p.output*(long?1.5:1))/1e6;
}
