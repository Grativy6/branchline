"""Fixed first-party pipe interface. Public bytes only; native key UI stays here."""
import base64
import json
import os
from pathlib import Path
import queue
import sys
import threading

# -I excludes cwd and PYTHONPATH; only this installed directory is added.
sys.path.insert(0,str(Path(__file__).resolve().parent))
from package import LIMIT, decode, inspect_files, pack, unpack, checked_stamp
from signer import Signer

def main():
    messages=queue.Queue(maxsize=2); closed=threading.Event()
    def read():
        try:
            for line in iter(lambda:sys.stdin.buffer.readline(3*LIMIT+1),b''):
                if len(line)>3*LIMIT: break
                messages.put(line)
        finally: closed.set()
    threading.Thread(target=read,daemon=True).start()
    folder=Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'.local/share')))/'Branchline'/'PEACHES'/'keys'
    signer=Signer(folder,closed.is_set)
    try:
        while not closed.is_set() or not messages.empty():
            signer.expire()
            try: line=messages.get(timeout=.2)
            except queue.Empty: continue
            request_id=None
            try:
                req=json.loads(line); request_id=req['id']; op=req['op']
                if op=='check':
                    files=unpack(decode(req['archive'])); result=inspect_files(files)
                    result['files']={k:base64.b64encode(v).decode() for k,v in files.items()}
                elif op=='pack':
                    files={k:decode(v) for k,v in req['files'].items()}; result={'archive':base64.b64encode(pack(files)).decode()}
                elif op=='origin':
                    _,result=checked_stamp(decode(req['envelope']))
                elif op=='sign':
                    # Validate the complete frozen package before presenting any native unlock.
                    files={k:decode(v) for k,v in req['files'].items()}; inspect_files(files)
                    nonce=bytes.fromhex(req['nonce'])
                    if len(nonce)!=32: raise ValueError('Invalid signing nonce.')
                    result={'stamp':base64.b64encode(signer.stamp(files['manifest.json'],nonce,req['claimedAt'])).decode()}
                elif op=='status': result=signer.status()
                elif op=='unlock': result=signer.unlock()
                elif op=='setup': result=signer.setup()
                elif op=='backup': result=signer.backup()
                elif op=='lock': result=signer.lock()
                elif op=='close': break
                else: raise ValueError('Unknown fixed PEACHES operation.')
                print(json.dumps({'id':request_id,'result':result},ensure_ascii=True),flush=True)
            except Exception as exc:
                # No traceback, inputs, key bytes, paths or passphrases in the host pipe.
                message=str(exc) if isinstance(exc,ValueError) else 'The local PEACHES operation could not be completed.'
                print(json.dumps({'id':request_id,'error':message},ensure_ascii=True),flush=True)
    finally: signer.lock()

if __name__=='__main__': main()
