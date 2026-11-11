"""One-time setup for the supported Ubuntu/WSL local training profile."""
from pathlib import Path
import argparse,subprocess,sys,json,os
def phase(name,message):print('BRANCHLINE_SETUP '+json.dumps({'phase':name,'message':message}),flush=True)
def run(args):subprocess.run([str(a) for a in args],check=True)
p=argparse.ArgumentParser();p.add_argument('--models',required=True);p.add_argument('--runtime');a=p.parse_args()
root=Path.home()/'.local/share/branchline-dreams';root.mkdir(parents=True,exist_ok=True);venv=root/'venv';python=venv/'bin/python';models=Path(a.models);models.mkdir(parents=True,exist_ok=True)
phase('libraries','Installing the local training libraries…')
if not python.exists():run([sys.executable,'-m','venv',venv])
run([python,'-m','pip','install','--upgrade','pip'])
run([python,'-m','pip','install','unsloth==2026.11.3','unsloth_zoo==2026.11.3','torch==2.14.1','transformers==5.17.0','peft==0.21.2','trl==1.15.0','triton==3.8.0','huggingface_hub==1.33.0'])
phase('model','Downloading the Qwen training checkpoint…')
download="from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3.5-4B',revision='851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a',local_dir="+repr(str(models/'Qwen3.5-4B'))+",allow_patterns=['*.json','*.safetensors','*.jinja','*.txt','LICENSE'])"
run([python,'-c',download])
phase('export','Preparing the local export tools…')
llama=root/'llama.cpp'
if not (llama/'.git').exists():run(['git','clone','--depth','1','https://github.com/ggml-org/llama.cpp',llama])
run(['git','-C',llama,'fetch','--depth','1','origin','3b4d6ab3f79651935fba1dd93732f29022a7f5f5'])
run(['git','-C',llama,'checkout','--detach','3b4d6ab3f79651935fba1dd93732f29022a7f5f5'])
run(['cmake','-S',llama,'-B',llama/'build','-DGGML_CUDA=OFF','-DGGML_NATIVE=OFF','-DLLAMA_CURL=OFF','-DLLAMA_BUILD_TESTS=OFF','-DLLAMA_BUILD_SERVER=OFF'])
run(['cmake','--build',llama/'build','--target','llama-quantize','-j','4'])
run([python,'-m','pip','install','-e',llama/'gguf-py'])
commit=subprocess.check_output(['git','-C',str(llama),'rev-parse','HEAD'],text=True).strip()
info=json.loads(subprocess.check_output([str(python),'-c',"import torch,json,importlib.metadata as m; print(json.dumps({'available':torch.cuda.is_available(),'gpu':torch.cuda.get_device_name() if torch.cuda.is_available() else None,'stack':{p:m.version(p) for p in ['torch','unsloth','unsloth_zoo','transformers','peft','trl','triton','huggingface_hub']}}))"],text=True))
if not info['available']:raise RuntimeError('The training environment cannot access the NVIDIA GPU.')
runtime={'profile':'branchline.dream-runtime/1','backend':'wsl','distro':os.environ.get('WSL_DISTRO_NAME','Ubuntu-24.04'),'python':str(python),'basePath':str(models/'Qwen3.5-4B'),'baseRevision':'851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a','llamaCpp':str(llama),'llamaCommit':commit,'gpu':info['gpu'],'stack':info['stack'],'qualification':'setup_ready'}
destination=Path(a.runtime) if a.runtime else models/'runtime.json';destination.parent.mkdir(parents=True,exist_ok=True)
temp=destination.with_name(destination.name+'.tmp');temp.write_text(json.dumps(runtime,indent=2),encoding='utf-8');temp.replace(destination)
phase('ready','Local training engine is ready.')
