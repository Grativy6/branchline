"""Local native key custody; no passphrase or private key leaves this process."""
import gc
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid
from datetime import datetime, timezone
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from vendor.floor import prepare_unsigned_stamp, issuer_signature_message, prepare_floor_stamp, derive_issuer_id, canonical_bytes

IDLE_SECONDS=15*60

def public(key):
    raw=key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)
    return {'issuerId':derive_issuer_id(raw)}

def encrypt(key, password):
    if not isinstance(password,bytes) or len(password)<12:
        raise ValueError('Use a passphrase of at least 12 characters.')
    algorithm=serialization.PrivateFormat.OpenSSH.encryption_builder().kdf_rounds(100).build(password)
    return key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.OpenSSH,algorithm)

def decrypt(data,password):
    if len(data)>65536 or not password:
        raise ValueError('Choose an encrypted Ed25519 OpenSSH key.')
    try:
        key=serialization.load_ssh_private_key(data,password=password)
        if not isinstance(key,Ed25519PrivateKey):
            raise ValueError('Unsupported key')
    except Exception:
        raise ValueError('The key could not be unlocked. Check the file and passphrase.') from None
    return key

def sign(key, declaration, nonce=None, claimed_at=None):
    raw=key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)
    body=prepare_unsigned_stamp(public_key=raw,declaration=declaration,
        media_type='application/json',claimed_at=claimed_at or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),nonce=nonce or os.urandom(32))
    return canonical_bytes(prepare_floor_stamp(body,key.sign(issuer_signature_message(body))))

def private_directory(folder):
    folder.mkdir(parents=True,exist_ok=True)
    if os.name=='nt':
        who=subprocess.run(['whoami','/user','/fo','csv','/nh'],capture_output=True,text=True,timeout=10,creationflags=subprocess.CREATE_NO_WINDOW,check=True)
        sid=re.search(r'S-1-\d+(?:-\d+)+',who.stdout)
        if not sid: raise ValueError('Could not establish the local key owner.')
        subprocess.run(['icacls',str(folder),'/inheritance:r','/grant:r','*'+sid.group(0)+':(OI)(CI)F'],capture_output=True,timeout=10,creationflags=subprocess.CREATE_NO_WINDOW,check=True)
    else: folder.chmod(0o700)

def durable_new(file,data):
    with file.open('xb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())
    if os.name!='nt': file.chmod(0o600)

class Signer:
    def __init__(self,folder,closed=None,clock=time.monotonic,idle=IDLE_SECONDS):
        self.folder=Path(folder); self.key=None; self.last=0; self.clock=clock; self.idle=idle
        self.closed=closed or (lambda:False)

    def expire(self):
        if self.key is not None and self.clock()-self.last>=self.idle: self.lock()

    def lock(self):
        self.key=None; self.last=0; gc.collect()
        return {'unlocked':False}

    def metadata(self):
        f=self.folder/'active.json'
        if not f.exists(): return None
        if f.stat().st_size>4096: raise ValueError('Invalid signing-identity settings.')
        m=json.loads(f.read_text('utf-8'))
        if not re.fullmatch(r'[a-f0-9-]{36}\.openssh',m.get('file','')): raise ValueError('Invalid signing identity.')
        return m

    def status(self):
        self.expire(); m=self.metadata()
        return {'configured':bool(m),'issuerId':m.get('issuerId') if m else None,
                'unlocked':self.key is not None,'recoverySaved':bool(m and m.get('recoverySaved')),
                'idleMinutes':15}

    def write_metadata(self,m):
        temp=self.folder/('active-'+str(uuid.uuid4())+'.tmp')
        durable_new(temp,json.dumps(m).encode()); os.replace(temp,self.folder/'active.json')

    def window(self,title):
        import tkinter as tk
        from tkinter import ttk
        root=tk.Tk(); root.title(title); root.resizable(False,False)
        root.attributes('-topmost',True)
        root.geometry('+%d+%d'%(max(0,root.winfo_screenwidth()//2-250),max(0,root.winfo_screenheight()//2-180)))
        root.configure(padx=22,pady=20)
        destroy=root.destroy
        def close():
            try:
                for callback in root.tk.call('after','info'): root.after_cancel(callback)
                destroy()
            except tk.TclError: pass
        root.destroy=close
        def stop():
            if self.closed(): root.destroy()
            else: root.after(150,stop)
        root.after(150,stop); root.after(120000,root.destroy)
        return root,tk,ttk

    def unlock(self):
        self.expire()
        if self.key is not None:
            self.last=self.clock(); return self.status()
        m=self.metadata()
        if not m: return self.setup()
        file=self.folder/m['file']
        if not file.exists(): raise ValueError('Signing key unavailable. Open a recovery copy in Signing identity. Your Book is still readable.')
        if file.stat().st_size>65536: raise ValueError('Invalid encrypted key.')
        raw=file.read_bytes()
        root,tk,ttk=self.window('Unlock your PEACHES signing identity')
        ttk.Label(root,text='Unlock for this local app session',font=('Segoe UI',13,'bold')).pack(anchor='w')
        ttk.Label(root,text='Locks after 15 idle minutes or when Branchline closes.\nOnly your Stamp and save action signs a version.',wraplength=440).pack(anchor='w',pady=(8,14))
        entry=ttk.Entry(root,show='●',width=45); entry.pack(); entry.focus_force()
        err=tk.StringVar(); ttk.Label(root,textvariable=err,wraplength=440).pack(pady=8)
        def accept():
            try:
                password=entry.get().encode('utf-8'); entry.delete(0,'end')
                key=decrypt(raw,password); password=None
                if public(key)['issuerId']!=m['issuerId']: raise ValueError('This key differs from the selected identity.')
                self.key=key; self.last=self.clock(); root.destroy()
            except Exception as e: err.set(str(e))
        ttk.Button(root,text='Unlock',command=accept).pack(side='right'); ttk.Button(root,text='Cancel',command=root.destroy).pack(side='right',padx=8)
        root.bind('<Return>',lambda _:accept()); root.mainloop()
        if self.key is None: raise ValueError('Signing cancelled. You can still save this version locally.')
        return self.status()

    def setup(self):
        from tkinter import filedialog
        root,tk,ttk=self.window('Your PEACHES signing identity')
        ttk.Label(root,text='A personal key for your saved versions',font=('Segoe UI',13,'bold')).pack(anchor='w')
        ttk.Label(root,text='Create a dedicated key, or select an encrypted OpenSSH recovery key.\nYour founding key is not selected automatically.',wraplength=460).pack(anchor='w',pady=10)
        mode=tk.StringVar(value='new'); selected={'file':None}; done=[]
        ttk.Radiobutton(root,text='Create a new personal key',variable=mode,value='new').pack(anchor='w')
        ttk.Radiobutton(root,text='Use an existing encrypted key',variable=mode,value='existing').pack(anchor='w')
        def choose():
            selected['file']=filedialog.askopenfilename(parent=root,title='Select an encrypted Ed25519 OpenSSH key') or None
            if selected['file']: mode.set('existing'); chosen.set(Path(selected['file']).name)
        chosen=tk.StringVar(value='No existing key selected')
        ttk.Button(root,text='Choose encrypted key…',command=choose).pack(anchor='w',pady=5)
        ttk.Label(root,textvariable=chosen,wraplength=450).pack(anchor='w')
        ttk.Label(root,text='Passphrase (12+ characters for a new key)').pack(anchor='w',pady=(12,0))
        password=ttk.Entry(root,show='●',width=48); password.pack()
        ttk.Label(root,text='Repeat passphrase (new keys only)').pack(anchor='w')
        confirm=ttk.Entry(root,show='●',width=48); confirm.pack()
        ttk.Label(root,text='Use for this local session; lock after 15 idle minutes.\nYou can export an encrypted recovery copy from the Book.',wraplength=450).pack(anchor='w',pady=10)
        err=tk.StringVar(); ttk.Label(root,textvariable=err,wraplength=450).pack()
        def accept():
            try:
                secret=password.get().encode('utf-8')
                if mode.get()=='new':
                    if password.get()!=confirm.get(): raise ValueError('The passphrases differ.')
                    key=Ed25519PrivateKey.generate(); raw=encrypt(key,secret)
                else:
                    if not selected['file']: raise ValueError('Choose your encrypted recovery key first.')
                    file=Path(selected['file'])
                    if file.stat().st_size>65536: raise ValueError('Key file is too large.')
                    raw=file.read_bytes(); key=decrypt(raw,secret)
                password.delete(0,'end'); confirm.delete(0,'end'); secret=None
                private_directory(self.folder)
                name=str(uuid.uuid4())+'.openssh'; durable_new(self.folder/name,raw)
                meta={'file':name,**public(key),'recoverySaved':False}
                self.write_metadata(meta); self.key=key; self.last=self.clock(); done.append(True); root.destroy()
            except Exception as e: err.set(str(e))
        ttk.Button(root,text='Use this identity',command=accept).pack(side='right'); ttk.Button(root,text='Cancel',command=root.destroy).pack(side='right',padx=8)
        root.mainloop()
        if not done: raise ValueError('Signing identity unchanged.')
        return self.status()

    def backup(self):
        from tkinter import filedialog, messagebox
        m=self.metadata()
        if not m: raise ValueError('Set up a signing identity first.')
        file=self.folder/m['file']
        if not file.exists(): raise ValueError('The encrypted key is unavailable.')
        root,tk,ttk=self.window('Save a new encrypted recovery copy'); root.withdraw()
        try:
            while True:
                name=filedialog.asksaveasfilename(parent=root,title='Save a new encrypted recovery copy',initialfile='PEACHES-personal-recovery.openssh',defaultextension='.openssh',confirmoverwrite=False)
                if not name:break
                destination=Path(name);encrypted=file.read_bytes()
                try:durable_new(destination,encrypted)
                except FileExistsError:
                    if destination.is_file() and destination.stat().st_size==len(encrypted) and destination.read_bytes()==encrypted:
                        m['recoverySaved']=True;self.write_metadata(m);break
                    messagebox.showinfo('Keep the earlier recovery copy','Choose a new filename. The existing file has been kept.',parent=root)
                    continue
                m['recoverySaved']=True;self.write_metadata(m);break
        finally:root.destroy()
        return self.status()

    def stamp(self,declaration,nonce,claimed_at):
        self.unlock()
        out=sign(self.key,declaration,nonce,claimed_at); self.last=self.clock()
        return out
