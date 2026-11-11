from pathlib import Path
import sys,tempfile,sqlite3,threading
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'server'/'personal_runtime'))
from hearthline_mcp.store import SharedScopedStore,canonical_json,sha256_text
from hearthline_mcp.personal_context import PersonalContext

with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);store=SharedScopedStore(root/'atomic','test');store.append({'number':0})
 failure=[]
 def writer():
  try:
   for i in range(1,35):store.append({'number':i})
  except Exception as e:failure.append(str(e))
 t=threading.Thread(target=writer);t.start()
 for _ in range(35):
  snapshot=store.read();head='GENESIS'
  for record in snapshot['records']:head=sha256_text(head+'\n'+canonical_json(record))
  assert snapshot['head']==head
 t.join();assert not failure
 context=PersonalContext(root/'original','user_a','profile')
 initial={'name':'Synthetic profile','orientation':'A synthetic orientation.','account':'Version one.','sources':[{'title':'Reference','origin':'synthetic','kind':'reference','text':'A retained source.'}]}
 context.host_change({'action':'create','operation':'create_1','content':initial},{'kind':'local_ui'})
 first=context.read();assert first['revision']=='create_1'
 proposal={'operation':'proposal_1','baseRevision':'create_1','account':'Suggested version.','sourceIds':[first['sources'][0]['id']]}
 context.propose(proposal,{'kind':'model'},'create_1');context.propose(proposal,{'kind':'model'},'create_1')
 assert len(context.state()['proposals'])==1
 try:context.host_change({'action':'create','operation':'bad','content':initial},{'kind':'model'});assert False
 except ValueError:pass
 other=PersonalContext(root/'original','user_b','profile')
 assert other.state()['current'] is None
 target=root/'restored';target.mkdir()
 src=sqlite3.connect(context.store.path);dst=sqlite3.connect(target/'.hearthline-store.sqlite3');src.backup(dst);src.close();dst.close()
 restored=PersonalContext(target,'user_a','profile');assert restored.read()==first
 print('PASS: consistent snapshots, isolated owners, fixed revisions, proposal replay, model/host separation and relocated continuity')
