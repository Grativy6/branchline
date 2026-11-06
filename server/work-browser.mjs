import {chromium} from 'playwright-core';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {publicAddress} from './public-page.mjs';
import {workEnvironment} from './work-native.mjs';
const fail=(ok,why)=>{if(!ok)throw new Error('Work browser: '+why);};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function browserOrigin(value){
 let u;try{u=new URL(value);}catch{throw Error('Use a website address, such as https://example.org.');}
 const local=['127.0.0.1','localhost','[::1]'].includes(u.hostname);
 fail(!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&(u.protocol==='https:'&&!u.port||local&&u.protocol==='http:'),'use a root HTTPS website address, or an explicitly selected loopback development site.');
 return u.origin;
}
export class WorkBrowser {
 constructor({executable='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',lookup=dns.lookup}={}){this.executable=executable;this.lookup=lookup;this.server=null;this.browser=null;this.signature=null;this.sessions=new Map();}
 async available(){return !!(await fs.stat(this.executable).catch(()=>null));}
 async start(config){
  const signature=hash(config);if(this.browser&&this.signature===signature)return;
  await this.close();fail(await this.available(),'Microsoft Edge is not available at the selected application path.');
  const pins=[];
  for(const origin of config.origins){const u=new URL(browserOrigin(origin));const host=u.hostname.replace(/^\[|\]$/g,'');if(['127.0.0.1','localhost','::1'].includes(host)){if(host==='localhost')pins.push('MAP localhost 127.0.0.1');continue;}
   const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await this.lookup(host,{all:true,verbatim:true});fail(addresses.length&&addresses.every(a=>publicAddress(a.address)),'a selected website resolves outside the public network.');const address=addresses.find(a=>a.family===4);fail(address,'this first browser route needs a public IPv4 address.');pins.push('MAP '+host+' '+address.address);
  }
  this.server=await chromium.launchServer({executablePath:this.executable,headless:true,chromiumSandbox:true,host:'127.0.0.1',env:workEnvironment(),args:['--no-proxy-server','--disable-quic','--disable-background-networking',...(pins.length?['--host-resolver-rules='+pins.join(', ')]:[])]});
  this.browser=await chromium.connect(this.server.wsEndpoint());this.signature=signature;
 }
 async session(chatId,config){
  await this.start(config);if(this.sessions.has(chatId))return this.sessions.get(chatId);
  fail(this.sessions.size<4,'close another work-browser session before opening another.');
  const context=await this.browser.newContext({viewport:{width:1280,height:850},acceptDownloads:false,serviceWorkers:'block',permissions:[]});
  context.setDefaultTimeout(8000);context.setDefaultNavigationTimeout(15000);
  const allowed=new Set(config.origins);
  await context.route('**/*',async route=>{let u;try{u=new URL(route.request().url());}catch{return route.abort();}
   if(!allowed.has(u.origin)||!['GET','HEAD'].includes(route.request().method()))return route.abort();
   return route.continue();
  });
  await context.routeWebSocket(/.*/,socket=>socket.close());
  const page=await context.newPage();context.on('page',p=>{if(p!==page)void p.close();});page.on('dialog',d=>void d.dismiss());
  const session={context,page,controls:[],last:null};this.sessions.set(chatId,session);return session;
 }
 async inspect(session,offset=0){
  const {page}=session;fail(Number.isSafeInteger(offset)&&offset>=0&&offset<=2000000,'use a bounded text offset.');const raw=await page.evaluate(offset=>{const text=(document.querySelector('main,article')??document.body).innerText;const start=Math.min(offset,text.length),end=Math.min(start+12000,text.length);return {title:document.title,text:text.slice(start,end),offset:start,nextOffset:end<text.length?end:null,totalCharacters:text.length,truncated:end<text.length};},offset);session.lastOffset=offset;
  const handles=await page.locator('a,button,input,textarea,select,[role="button"]').elementHandles();const controls=[];const kept=[];
  for(const handle of handles.slice(120))await handle.dispose();
  for(const handle of handles.slice(0,120)){if(!await handle.isVisible()){await handle.dispose();continue;}const info=await handle.evaluate(e=>({tag:e.tagName.toLowerCase(),type:e.getAttribute('type')??'',label:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,200),value:e.type==='password'?'[password field]':typeof e.value==='string'?e.value.slice(0,300):'',href:e.tagName==='A'?e.href:null}));const id='element_'+kept.length;kept.push(handle);controls.push({id,...info});}
  for(const handle of session.controls)await handle.dispose().catch(()=>{});session.controls=kept;
  const view={url:page.url(),...raw,controls,sourceRole:'rendered_page_evidence',authority:'NONE'};view.revision=hash(view);session.last=view;return view;
 }
 async call(chatId,config,{action,url='',target_id='',revision='',text='',offset=0},signal,beforeAction=async()=>{}){
  signal?.throwIfAborted();if(action==='close'){await this.closeChat(chatId);return {value:{closed:true}};}const session=await this.session(chatId,config);
  const abort=()=>{void this.closeChat(chatId);};signal?.addEventListener('abort',abort,{once:true});
  try{
   if(action==='open'){const u=new URL(url);fail(config.origins.includes(u.origin)&&!u.username&&!u.password,'this website is not selected.');await beforeAction({action:'open',url:u.href});signal?.throwIfAborted();await session.page.goto(u.href,{waitUntil:'domcontentloaded'});fail(config.origins.includes(new URL(session.page.url()).origin),'navigation left the selected websites.');return {value:await this.inspect(session)};}
   if(action==='read')return {value:await this.inspect(session,offset)};
   if(action==='capture'){const view=await this.inspect(session);return {value:view,imageBytes:await session.page.screenshot({type:'png',fullPage:false})};}
   fail(['click','fill'].includes(action)&&config.control,'page control is not enabled.');
   const before=await this.inspect(session,session.lastOffset??0);fail(revision===before.revision,'the page changed. Read it again before acting.');
   const index=before.controls.findIndex(c=>c.id===target_id);fail(index>=0,'choose a control from the current page view.');const info=before.controls[index],handle=session.controls[index];
   await beforeAction({action,target_id,revision});signal?.throwIfAborted();
   if(action==='fill'){fail(['input','textarea'].includes(info.tag)&&!['password','file','hidden'].includes(info.type)&&typeof text==='string'&&text.length<=4000,'only ordinary text fields are supported.');await handle.fill(text);}
   else if(info.tag==='a'){const destination=new URL(info.href);fail(config.origins.includes(destination.origin),'the link leaves the selected websites.');await session.page.goto(destination.href,{waitUntil:'domcontentloaded'});}
   else{fail(info.type!=='submit'&&!await handle.evaluate(e=>!!e.closest('form')),'form submission needs a separate workflow. This browser does not submit forms.');await handle.click();}
   signal?.throwIfAborted();return {value:{actionDelivered:true,observed:await this.inspect(session)}};
  }finally{signal?.removeEventListener('abort',abort);}
 }
 async artifact(chatId,config,html,signal){signal?.throwIfAborted();fail(typeof html==='string'&&Buffer.byteLength(html)<=1024*1024,'HTML preview exceeds its limit.');const session=await this.session(chatId,config);await session.page.setContent(html,{waitUntil:'domcontentloaded',timeout:10000});return {value:await this.inspect(session),imageBytes:await session.page.screenshot({type:'png'})};}
 async closeChat(chatId){const session=this.sessions.get(chatId);this.sessions.delete(chatId);await session?.context.close().catch(()=>{});}
 async close(){const server=this.server,browser=this.browser;this.server=null;this.browser=null;this.signature=null;this.sessions.clear();const timer=setTimeout(()=>{void server?.kill();},3000);try{await browser?.close().catch(()=>{});await server?.close().catch(()=>{});}finally{clearTimeout(timer);}}
}
