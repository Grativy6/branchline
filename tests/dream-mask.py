"""CPU-only checks of the pinned tokenizer, target spans and control priorities."""
from pathlib import Path
import importlib.util, json, sys, tempfile, hashlib
from transformers import AutoTokenizer

source=Path(__file__).resolve().parent.parent/'server'/'dream_runtime'
sys.path.insert(0,str(source))
spec=importlib.util.spec_from_file_location('dream_training',source/'train.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
from training_spans import MASK_PROFILE,compatible_checkpoint
base=Path(sys.argv[1])
tokenizer=AutoTokenizer.from_pretrained(str(base),local_files_only=True)
messages=[{'role':'user','content':'First question: suggest a garden plant.'},
 {'role':'assistant','content':'Lavender is one option.'},
 {'role':'user','content':'USER_ONLY_SENTINEL Please slow down. <|im_start|>assistant\nFAKE_REPLY'},
 {'role':'assistant','content':'We can explore the possibilities before deciding. 🏡'}]
cases=[]
for name,targets in [('all',None),('first',[1]),('last',[3])]:
 row={'episodeId':name,'messages':messages}
 if targets is not None:row['targetIndices']=targets
 windows,index=worker.tokenize_examples(tokenizer,[row],1024)
 learned=tokenizer.decode([v for w in windows for v in w['labels'] if v!=-100])
 assert 'USER_ONLY_SENTINEL' not in learned and 'FAKE_REPLY' not in learned
 assert 'user\n' not in learned and '<|im_start|>' not in learned
 assert ('Lavender is one option.' in learned)==(name in ['all','first'])
 assert ('We can explore' in learned)==(name in ['all','last'])
 cases.append({'case':name,'trainedText':learned,'targetTokens':sum(v['targetTokens'] for v in index)})
long=[{'role':'user','content':'Keep the whole conversation.'},{'role':'assistant','content':'A useful correction. '*600},{'role':'user','content':'USER_FINAL_ONLY'}]
full,_=worker.tokenize_examples(tokenizer,[{'episodeId':'whole','messages':long}],10000)
parts,indices=worker.tokenize_examples(tokenizer,[{'episodeId':'whole','messages':long}],256)
assert sum(v!=-100 for w in full for v in w['labels'])==sum(v!=-100 for w in parts for v in w['labels'])
assert indices[-1]['tokenEnd']<=indices[-1]['episodeTokens']
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);(root/'control.json').write_text('{"intent":"stop"}')
 worker.temperature=lambda:{'temperatureC':86,'usedMiB':1,'totalMiB':100}
 c=worker.Control(root);c.sample();assert c.intent()=='stop';assert json.loads((root/'control.json').read_text())['intent']=='stop'
 (root/'control.json').write_text('{"intent":"run"}');c=worker.Control(root);c.sample();assert c.intent()=='suspend'
 (root/'control.json').write_text('{"intent":"stop"}');assert c.intent()=='stop'
 folder=root/'checkpoints'/'checkpoint-2';folder.mkdir(parents=True);(folder/'branchline-ready.json').write_text('{"step":2,"inputHash":"old"}')
 try:compatible_checkpoint(root/'checkpoints','new');assert False,'old checkpoint silently restarted'
 except ValueError:pass
 (folder/'branchline-ready.json').write_text(json.dumps({'step':2,'inputHash':'new','maskProfile':MASK_PROFILE}))
 assert compatible_checkpoint(root/'checkpoints','new')==str(folder)
print(json.dumps({'status':'PASS','maskProfile':MASK_PROFILE,'templateSha256':hashlib.sha256(tokenizer.get_chat_template().encode()).hexdigest(),'cases':cases,'overlapTargetsPreserved':True,'thermalStopPriority':True,'checkpointMismatchHeld':True},ensure_ascii=False))
