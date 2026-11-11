"""No real key or native window: test the create-a-copy dialog contract."""
from pathlib import Path
import sys,tempfile,importlib.util,types
source=Path(__file__).resolve().parent.parent/'server'/'peaches_runtime'/'signer.py'
sys.path.insert(0,str(source.parent))
spec=importlib.util.spec_from_file_location('signer_fixture',source);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);(root/'current.openssh').write_bytes(b'synthetic encrypted bytes')
 existing=root/'earlier.openssh';existing.write_bytes(b'earlier recovery bytes');fresh=root/'new.openssh'
 answers=iter([str(existing),str(fresh)]);messages=[]
 def choose(**options):assert options['confirmoverwrite'] is False;return next(answers)
 sys.modules['tkinter']=types.SimpleNamespace(filedialog=types.SimpleNamespace(asksaveasfilename=choose),messagebox=types.SimpleNamespace(showinfo=lambda *a,**k:messages.append(a)))
 signer=module.Signer(root);metadata={'file':'current.openssh','recoverySaved':False}
 signer.metadata=lambda:metadata;signer.write_metadata=lambda m:None;signer.status=lambda:dict(metadata)
 signer.window=lambda title:(types.SimpleNamespace(withdraw=lambda:None,destroy=lambda:None),None,None)
 result=signer.backup();assert result['recoverySaved'];assert messages
 assert existing.read_bytes()==b'earlier recovery bytes';assert fresh.read_bytes()==b'synthetic encrypted bytes'
 print('PASS: existing recovery copy kept, clear filename feedback, new copy saved without a misleading overwrite confirmation')
