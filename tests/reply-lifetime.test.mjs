import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,input,until,callTool,finish} from './desk-helpers.mjs';
import {RESOURCE_DEFAULTS,RESOURCE_FIELDS,resourceSettings,checkResources} from '../public/resource-settings.js';

test('a reply continues past the former app deadline across tools; Stop and provider errors still work',async()=>{
 // The old deadline injection would abort this request after 30ms.
 const f=await fixture({modelOptions:{timeoutMs:30}});try{
 await f.command('root.resources',{id:f.app.store.state.roots[0].id,resources:{...RESOURCE_DEFAULTS,replySeconds:300}});
 const first=await f.app.deskTasks.admit({...input(f,'Continue this work.'),toolsEnabled:true});
 await until(()=>f.requests.length===1,'first request');await delay(100);
 assert.equal(f.app.store.state.deskWork.tasks.find(t=>t.id===first.taskIds[0]).status,'running');
 callTool(f.requests[0],'read_drawer',{name:'',offset:0});await until(()=>f.requests.length===2,'tool continuation');await delay(100);
 assert.equal(f.app.store.state.deskWork.tasks.find(t=>t.id===first.taskIds[0]).status,'running');
 finish(f.requests[1],'Finished when the work was done.');await until(()=>f.app.store.state.deskWork.tasks[0].status==='completed','completion');
 const second=await f.app.deskTasks.admit(input(f,'Stop this one.','stop_test'));await until(()=>f.requests.length===3,'second request');
 await f.app.deskTasks.cancel(second.taskIds[0]);await until(()=>f.app.store.state.deskWork.tasks[1].status==='cancelled','explicit Stop');
 await f.app.deskTasks.admit(input(f,'Report a connection failure.','failure_test'));await until(()=>f.requests.length===4,'third request');f.requests[3].res.writeHead(503);f.requests[3].res.end();
 await until(()=>f.app.store.state.deskWork.tasks[2].status==='failed','provider error');assert.match(f.app.store.state.deskWork.tasks[2].error,/HTTP 503/);
 }finally{await f.close();}
});
test('the reply deadline is absent from controls and effective settings, while saved history remains readable',()=>{
 const saved={...RESOURCE_DEFAULTS,replySeconds:300};checkResources(saved);checkResources(RESOURCE_DEFAULTS);
 assert(!Object.hasOwn(RESOURCE_FIELDS,'replySeconds'));assert(!Object.hasOwn(RESOURCE_DEFAULTS,'replySeconds'));
 assert(!Object.hasOwn(resourceSettings({resources:saved}),'replySeconds'));
 assert.equal(saved.replySeconds,300);
});
