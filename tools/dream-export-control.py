"""Untrained export control for the local Dream qualification; no training."""
from pathlib import Path
import json,sys,importlib.util
source=Path(__file__).resolve().parent.parent/'server'/'dream_runtime'
sys.path.insert(0,str(source))
spec=importlib.util.spec_from_file_location('dream_export',source/'train.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
run=Path(sys.argv[1]);control=Path(sys.argv[2]);control.mkdir(parents=True,exist_ok=False)
job=json.loads((run/'job.json').read_text())
module.export_model(job,control,merge_adapter=False)
from safetensors.torch import load_file
weights=load_file(str(run/'adapter'/'adapter_model.safetensors'))
b=[v.float() for k,v in weights.items() if 'lora_B' in k]
report={'profile':'branchline.untrained-export-control/1','baseRevision':job['engine']['baseRevision'],
        'quantization':'Q4_K_M','mergeAdapter':False,'adapterBTensors':len(b),
        'nonzeroAdapterBTensors':sum(bool(v.count_nonzero()) for v in b),
        'adapterBAbsoluteSum':sum(float(v.abs().sum()) for v in b)}
(control/'control.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
