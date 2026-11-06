import { sessionFetch } from './session.js';

export function createStartupProgress({ changed }) {
  let current={phase:'none'}, stopped=false;
  const panel=document.getElementById('startup-progress');
  async function poll() {
    if(stopped)return;
    try {
      const response=await sessionFetch('/api/startup-progress');
      if(response.ok){current=await response.json();changed();}
    } catch { /* Keep the last observed state until the local app answers. */ }
    if(['none','ready','failed','cancelled','already_open'].includes(current.phase))stopped=true;
    else setTimeout(poll,500);
  }
  return {
    start:poll,
    render(){panel.hidden=['none','ready','already_open'].includes(current.phase);panel.textContent=panel.hidden?'':current.message;},
    blocks(model){
      if(!['opening','preparing'].includes(current.phase)||current.modelIdentifier!==model?.model)return false;
      try{const url=new URL(model.baseUrl);return ['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&Number(url.port)===current.modelPort;}catch{return false;}
    },
  };
}
