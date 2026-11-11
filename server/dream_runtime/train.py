"""Branchline's local Dream worker. Selected text is data, never Python code."""
from pathlib import Path
import argparse, json, os, sys, time, math, hashlib, subprocess, signal, shutil, threading
from training_spans import MASK_PROFILE, token_targets, tokenizer_identity, compatible_checkpoint

def local_path(value):
    value=str(value)
    if os.name!='nt' and len(value)>2 and value[1]==':':
        return Path('/mnt/'+value[0].lower()+value[2:].replace('\\','/'))
    return Path(value)

def emit(kind, **values):
    print('BRANCHLINE_DREAM '+json.dumps({'kind':kind,**values},ensure_ascii=False),flush=True)

def atomic(file, value):
    file=Path(file);file.parent.mkdir(parents=True,exist_ok=True)
    temp=file.with_name(file.name+'.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    temp.replace(file)

def temperature():
    try:
        p=subprocess.run(['nvidia-smi','--query-gpu=temperature.gpu,memory.used,memory.total','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=4)
        values=[float(x.strip()) for x in p.stdout.strip().splitlines()[0].split(',')]
        return {'temperatureC':values[0],'usedMiB':values[1],'totalMiB':values[2]}
    except Exception:return {}

class EndRun(Exception):
    def __init__(self,status):self.status=status

class Control:
    def __init__(self,root):
        self.root=root;self.last_thermal=0;self.thermal_suspend=False;self.emergency_stop=False
        try:prior=json.loads((root/'resources.json').read_text())
        except (OSError,ValueError):prior={}
        self.peak_c=prior.get('peakTemperatureC',0);self.peak_mib=prior.get('peakUsedMiB',0)
    def intent(self):
        if self.emergency_stop:return 'stop'
        try:chosen=json.loads((self.root/'control.json').read_text())['intent']
        except (OSError,ValueError,KeyError):chosen='run'
        if chosen=='stop':return 'stop'
        return 'suspend' if self.thermal_suspend else chosen
    def sample(self):
        if time.monotonic()-self.last_thermal<3:return None
        self.last_thermal=time.monotonic();v=temperature()
        self.peak_c=max(self.peak_c,v.get('temperatureC',0));self.peak_mib=max(self.peak_mib,v.get('usedMiB',0))
        if v:
            atomic(self.root/'resources.json',{**v,'peakTemperatureC':self.peak_c,'peakUsedMiB':self.peak_mib})
            emit('resources',**v,peakTemperatureC=self.peak_c,peakUsedMiB=self.peak_mib)
        if v.get('temperatureC',0)>=85 and self.intent()!='stop':
            self.thermal_suspend=True
            emit('thermal_pause',message='GPU reached 85°C. Saving progress to cool down.')
        return v
    def boundary(self):
        self.sample();reported=False
        while self.intent()=='hold':
            if not reported:emit('held',message='Paused at a safe boundary');reported=True
            time.sleep(.2);self.sample()
        intent=self.intent()
        if intent in ['stop','suspend']:raise EndRun('stopped' if intent=='stop' else 'suspended')
        if reported:emit('continued')

def tokenize_examples(tokenizer, examples, length):
    """Retain an episode's order across overlapping windows; learn assistant turns."""
    windows=[];index=[]
    for row in examples:
        messages=row['messages']
        targets=[i for i,m in enumerate(messages) if m['role']=='assistant' and i in set(row.get('targetIndices',range(len(messages))))]
        ids,labels=token_targets(tokenizer,messages,targets)
        stride=max(1,length-min(256,length//4));previous_end=0
        for offset in range(0,len(ids),stride):
            stop=min(offset+length,len(ids));lab=labels[offset:stop].copy()
            for i in range(max(0,previous_end-offset)):lab[i]=-100
            if any(x!=-100 for x in lab):
                windows.append({'input_ids':ids[offset:stop],'labels':lab,'attention_mask':[1]*(stop-offset)})
                index.append({'episodeId':row['episodeId'],'tokenStart':offset,'tokenEnd':stop,'episodeTokens':len(ids),'targetTokens':sum(x!=-100 for x in lab)})
            previous_end=stop
            if stop==len(ids):break
    if not windows:raise ValueError('The prepared notes contain no assistant response tokens to learn from.')
    return windows,index

def train(job,root,control):
    if job['recipe'].get('maskProfile')!=MASK_PROFILE:raise ValueError('This unfinished Dream uses the earlier training recipe. Its notes and checkpoints are kept. Stop it and start a new Dream for the corrected recipe.')
    # Unsloth must patch before Transformers/PEFT are imported.
    from unsloth import FastVisionModel
    import torch
    from transformers import Trainer,TrainingArguments,TrainerCallback
    from peft import set_peft_model_state_dict
    from safetensors.torch import load_file
    base=local_path(job['engine']['basePath'])
    if not (base/'config.json').exists():raise ValueError('The training checkpoint is missing. Open Settings → Dreams → Set up local training.')
    control.boundary();emit('phase',phase='loading',message='Loading Qwen for local training')
    model,processor=FastVisionModel.from_pretrained(model_name=str(base),load_in_4bit=False,load_in_8bit=False,dtype=torch.bfloat16,use_gradient_checkpointing='unsloth',max_seq_length=job['recipe']['contextTokens'])
    # The first profile trains text. Keep the frozen vision encoder in CPU RAM.
    visual=getattr(getattr(model,'model',None),'visual',None)
    if visual is not None:visual.to('cpu');torch.cuda.empty_cache()
    model=FastVisionModel.get_peft_model(model,finetune_vision_layers=False,finetune_language_layers=True,finetune_attention_modules=True,finetune_mlp_modules=True,r=job['recipe']['rank'],lora_alpha=job['recipe']['rank']*2,lora_dropout=0,bias='none',random_state=job['recipe']['seed'],use_rslora=False)
    if job.get('parentAdapter'):
        parent=local_path(job['parentAdapter'])/'adapter_model.safetensors'
        if not parent.is_file():raise ValueError('The preceding Dream adapter is missing; the base model was not substituted.')
        set_peft_model_state_dict(model,load_file(str(parent)))
    tokenizer=getattr(processor,'tokenizer',processor)
    examples=json.loads((root/'examples.json').read_text(encoding='utf-8'))
    rows,index=tokenize_examples(tokenizer,examples,job['recipe']['contextTokens'])
    atomic(root/'training-windows.json',index)
    control.boundary()
    class Data(torch.utils.data.Dataset):
        def __len__(self):return len(rows)
        def __getitem__(self,i):return rows[i]
    def collate(batch):
        size=max(len(x['input_ids']) for x in batch);pad=tokenizer.pad_token_id or tokenizer.eos_token_id
        return {k:torch.tensor([x[k]+([pad if k=='input_ids' else -100 if k=='labels' else 0]*(size-len(x[k]))) for x in batch],dtype=torch.long) for k in ['input_ids','labels','attention_mask']}
    checkpoint_dir=root/'checkpoints';ending={'status':None};trainer=None
    fingerprint=hashlib.sha256(json.dumps({'baseRevision':job['engine'].get('baseRevision'),'recipe':job['recipe'],'parentAdapterDigest':job.get('parentAdapterDigest'),'examples':examples,'tokenizer':tokenizer_identity(tokenizer)},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    def mark_checkpoint(step):
        atomic(checkpoint_dir/f'checkpoint-{step}'/'branchline-ready.json',{'step':step,'inputHash':fingerprint,'maskProfile':MASK_PROFILE})
    def latest_checkpoint():
        return compatible_checkpoint(checkpoint_dir,fingerprint)
    class Observer(TrainerCallback):
        def on_step_begin(self,args,state,ctl,**kw):
            try:control.boundary()
            except EndRun as e:
                if e.status=='suspended':trainer._save_checkpoint(model,None);mark_checkpoint(state.global_step)
                raise
            return ctl
        def on_step_end(self,args,state,ctl,**kw):
            emit('progress',phase='training',step=state.global_step,totalSteps=state.max_steps,epoch=state.epoch)
            control.sample()
            intent=control.intent()
            if intent in ['stop','suspend']:
                ending['status']='stopped' if intent=='stop' else 'suspended';ctl.should_training_stop=True;ctl.should_save=intent=='suspend'
            return ctl
        def on_save(self,args,state,ctl,**kw):
            mark_checkpoint(state.global_step)
            return ctl
        def on_log(self,args,state,ctl,logs=None,**kw):
            if logs and 'loss' in logs:
                if not math.isfinite(float(logs['loss'])):raise ValueError('Training produced a non-finite loss. The existing generation is unchanged.')
                emit('loss',step=state.global_step,loss=logs['loss'])
    warmup=1 if math.ceil(len(rows)/job['recipe']['accumulation'])*job['recipe']['epochs']>2 else 0
    args=TrainingArguments(output_dir=str(checkpoint_dir),per_device_train_batch_size=1,gradient_accumulation_steps=job['recipe']['accumulation'],num_train_epochs=job['recipe']['epochs'],learning_rate=job['recipe']['learningRate'],bf16=True,fp16=False,optim='adamw_torch',logging_steps=1,save_strategy='steps',save_steps=25,save_total_limit=2,report_to='none',seed=job['recipe']['seed'],data_seed=job['recipe']['seed'],remove_unused_columns=False,dataloader_num_workers=0,gradient_checkpointing=True,lr_scheduler_type='linear',warmup_steps=warmup,disable_tqdm=True)
    trainer=Trainer(model=model,args=args,train_dataset=Data(),data_collator=collate,callbacks=[Observer()])
    last=latest_checkpoint()
    emit('phase',phase='training',message='Resuming the saved training checkpoint' if last else 'Training the recorded batch from its beginning',examples=len(rows),resumed=bool(last))
    output=trainer.train(resume_from_checkpoint=last)
    if ending['status']:
        checkpoint=latest_checkpoint()
        if ending['status']=='suspended' and not checkpoint:
            trainer._save_checkpoint(model,None);mark_checkpoint(trainer.state.global_step)
        raise EndRun(ending['status'])
    adapter=root/'adapter';model.save_pretrained(str(adapter));processor.save_pretrained(str(adapter))
    atomic(root/'trained.json',{'step':trainer.state.global_step,'loss':output.training_loss,'examples':len(rows),'adapter':'adapter','baseRevision':job['engine'].get('baseRevision'),'recipe':job['recipe']})
    emit('trained',step=trainer.state.global_step,loss=output.training_loss,examples=len(rows))
    del trainer,model
    import gc
    torch.compiler.reset();gc.collect();torch.cuda.empty_cache()
    if torch.cuda.memory_allocated()<512*1024*1024:emit('gpu_released')

def export_model(job,root,*,merge_adapter=True):
    """CPU merge/conversion: a stopped export can restart without retraining."""
    import torch
    from transformers import AutoModelForImageTextToText,AutoProcessor
    from peft import PeftModel
    base=local_path(job['engine']['basePath']);merged_dir=root/'export-work'/'merged';merged_dir.mkdir(parents=True,exist_ok=True)
    emit('phase',phase='exporting',message='Combining the trained adapter for local use')
    model=AutoModelForImageTextToText.from_pretrained(str(base),dtype=torch.bfloat16,device_map='cpu',low_cpu_mem_usage=True)
    if merge_adapter:model=PeftModel.from_pretrained(model,str(root/'adapter')).merge_and_unload()
    # Transformers does not retain Qwen's unused MTP head. Do not declare a
    # thirty-third block when only the 32 language blocks are being exported.
    text_config=getattr(model.config,'text_config',model.config)
    if getattr(text_config,'mtp_num_hidden_layers',0) and not any('mtp.' in name for name in model.state_dict()):
        text_config.mtp_num_hidden_layers=0
    model.save_pretrained(str(merged_dir),max_shard_size='2GB',safe_serialization=True)
    AutoProcessor.from_pretrained(str(base)).save_pretrained(str(merged_dir))
    del model
    import gc
    gc.collect()
    llama=local_path(job['engine']['llamaCpp']);bf16=root/'export-work'/'model-bf16.gguf.partial';candidate=root/'candidate.gguf'
    converter=llama/'convert_hf_to_gguf.py';quantizer=llama/'build/bin/llama-quantize'
    if os.name=='nt':quantizer=llama/'build/bin/Release/llama-quantize.exe'
    subprocess.run([sys.executable,str(converter),str(merged_dir),'--outfile',str(bf16),'--outtype','bf16','--no-mtp'],check=True)
    subprocess.run([str(quantizer),str(bf16),str(candidate)+'.partial','Q4_K_M'],check=True)
    Path(str(candidate)+'.partial').replace(candidate)
    atomic(root/'exported.json',{'modelFile':'candidate.gguf','adapter':'adapter' if merge_adapter else None,'untrainedControl':not merge_adapter})

def managed_export(job,root,control):
    control.boundary()
    if (root/'exported.json').is_file() and (root/'candidate.gguf').is_file():return
    emit('phase',phase='exporting',message='Exporting a model Branchline can use')
    child=subprocess.Popen([sys.executable,'-B','-u',__file__,'--job',str(root/'job.json'),'--export'],start_new_session=os.name!='nt')
    held=False
    while child.poll() is None:
        control.sample();intent=control.intent()
        if intent in ['stop','suspend']:
            if os.name!='nt':os.killpg(child.pid,signal.SIGCONT);os.killpg(child.pid,signal.SIGTERM)
            else:child.terminate()
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                if os.name!='nt':os.killpg(child.pid,signal.SIGKILL)
                else:child.kill()
                child.wait()
            raise EndRun('stopped' if intent=='stop' else 'suspended')
        if os.name!='nt' and intent=='hold' and not held:os.killpg(child.pid,signal.SIGSTOP);held=True;emit('held',message='Export paused')
        if os.name!='nt' and intent!='hold' and held:os.killpg(child.pid,signal.SIGCONT);held=False;emit('continued')
        time.sleep(.4)
    if child.returncode:raise ValueError('The model export could not finish. Training progress is retained for retry.')

def main():
    p=argparse.ArgumentParser();p.add_argument('--job');p.add_argument('--probe',action='store_true');p.add_argument('--export',action='store_true');p.add_argument('--parent-watch',action='store_true');args=p.parse_args()
    if args.probe:
        import torch,transformers,peft
        print(json.dumps({'available':torch.cuda.is_available(),'torch':torch.__version__,'transformers':transformers.__version__,'peft':peft.__version__,'gpu':torch.cuda.get_device_name() if torch.cuda.is_available() else None,**temperature()}));return
    root=local_path(args.job).resolve().parent;job=json.loads((root/'job.json').read_text(encoding='utf-8'));control=Control(root)
    if args.export:export_model(job,root);return
    if args.parent_watch:
        def watch_parent():
            for line in sys.stdin:
                if line.strip()=='stop':control.emergency_stop=True;return
            control.emergency_stop=True
        threading.Thread(target=watch_parent,daemon=True).start()
    try:
        if not (root/'trained.json').exists():train(job,root,control)
        managed_export(job,root,control)
        result={'status':'ready',**json.loads((root/'trained.json').read_text()),**json.loads((root/'exported.json').read_text()),'peakTemperatureC':control.peak_c,'peakUsedMiB':control.peak_mib}
        atomic(root/'result.json',result);emit('finished',**result)
    except EndRun as e:
        result={'status':e.status,'checkpoint':(root/'trained.json').exists() or (root/'checkpoints').exists(),'peakTemperatureC':control.peak_c,'peakUsedMiB':control.peak_mib}
        atomic(root/'result.json',result);emit('finished',**result)
    except Exception as e:
        import traceback
        traceback.print_exc();atomic(root/'result.json',{'status':'failed','error':str(e)});emit('error',message=str(e));sys.exit(1)

if __name__=='__main__':main()
