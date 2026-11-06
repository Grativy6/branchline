"""Small, model-neutral personal continuity over the existing scoped store."""
from __future__ import annotations
import copy
import hashlib
import json
import re
from datetime import datetime, timezone
from .store import SharedScopedStore, canonical_json

FORMAT = "hearthline.personal-context/1"
ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")

def require(condition, why):
    if not condition:
        raise ValueError(why)

def exact(obj, keys):
    require(isinstance(obj, dict) and set(obj) == set(keys), "Unexpected or missing fields")

def text(value, limit, empty=False):
    require(isinstance(value, str) and len(value) <= limit and (empty or value.strip())
            and '\x00' not in value, "Invalid or oversized text")
    return value

def digest(value):
    return hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()

def content(value):
    exact(value, ['name', 'orientation', 'account', 'sources'])
    text(value['name'],120); text(value['orientation'],8000,True); text(value['account'],8000,True)
    require(len(value['orientation'])+len(value['account']) <= 8000, "Orientation and account exceed 8000 characters")
    require(isinstance(value['sources'],list) and len(value['sources']) <= 12, "At most twelve sources")
    sources=[]
    for source in value['sources']:
        exact(source,['title','origin','kind','text'])
        text(source['title'],200); text(source['origin'],500)
        require(source['kind'] in ['reference','fiction','conversation','interpretation'], "Unknown source kind")
        text(source['text'],65536)
        sources.append({**copy.deepcopy(source),'id':'S'+digest(source)[:32],'sha256':digest(source)})
    require(sum(len(s['text'].encode('utf-8')) for s in sources)<=65536, "Sources exceed 64 KiB")
    require(len({s['id'] for s in sources})==len(sources), "Duplicate source")
    return {**copy.deepcopy(value),'sources':sources}

def portable_content(value):
    return {**copy.deepcopy(value),'sources':[{k:s[k] for k in ['title','origin','kind','text']} for s in value['sources']]}

class PersonalContext:
    def __init__(self, root, user, profile):
        require(bool(ID.fullmatch(user)) and bool(ID.fullmatch(profile)), "Invalid bound user/profile")
        self.profile=profile
        self.store=SharedScopedStore(root,'personal:'+profile,adapter='hearthline:personal-context',user=user)
        # This new service uses an explicit logical owner/profile identity.
        # Existing toolkit namespaces keep their physical-root binding unchanged.
        # A deliberate workspace backup can therefore move without losing its records.
        self.store.namespace='personal-'+digest({'format':FORMAT,'user':user,'profile':profile})

    def state(self):
        snapshot=self.store.read()
        events=[r for r in snapshot['records'] if r.get('kind')=='personal.context']
        revisions=[r for r in events if r['event'] in ['create','accept','import','revise']]
        proposals=[r for r in events if r['event']=='propose']
        decisions={r['proposal']:r['event'] for r in events if r['event'] in ['accept','reject']}
        return {'profile':self.profile,'head':snapshot['head'],'current':revisions[-1] if revisions else None,
                'revisions':revisions,'proposals':[{**p,'decision':decisions.get(p['operation'],'pending')} for p in proposals],
                'events':events}

    def inspect(self):
        state=self.state()
        # The current editable content is returned once. Earlier revisions keep
        # their complete prose and source identities without repeating file text.
        def summary(row):
            result=copy.deepcopy(row)
            if 'content' in result:
                result['content']['sources']=[{k:s[k] for k in ['id','title','origin','kind','sha256']} for s in result['content']['sources']]
            result.pop('historicalSources',None)
            return result
        return {**state,'revisions':[summary(r) for r in state['revisions']],
                'events':[{'operation':r['operation'],'importedHistory':r['importedHistory']}
                          for r in state['events'] if 'importedHistory' in r]}

    def append(self, event, operation, payload, author, expected_head=None):
        require(isinstance(operation,str) and bool(ID.fullmatch(operation)), "Invalid operation identity")
        fingerprint=digest({'event':event,'payload':payload,'author':author})
        for _ in range(8):
            state=self.state()
            prior=next((e for e in state['events'] if e['operation']==operation),None)
            if prior:
                require(prior['fingerprint']==fingerprint,"Operation identity reused with different content")
                return prior
            if expected_head is not None:
                require(state['head']==expected_head,"Profile changed; reopen before accepting")
            record={'kind':'personal.context','event':event,'operation':operation,'fingerprint':fingerprint,
                    'at':datetime.now(timezone.utc).isoformat(),'author':copy.deepcopy(author),**copy.deepcopy(payload)}
            saved=self.store.append_if_head(state['head'],record)
            if saved is not None:
                return record
        raise ValueError('Concurrent changes; retry this same operation identity after reading')

    def current(self, revision=None):
        state=self.state()
        row=next((r for r in state['revisions'] if r['operation']==revision),None) if revision else state['current']
        require(row is not None,"Profile or selected revision is unavailable")
        return row

    def read(self, revision=None):
        row=self.current(revision)
        data=row['content']
        proposal=next((p for p in self.state()['proposals'] if p['operation']==row.get('proposal')),None)
        return {'profile':self.profile,'revision':row['operation'],'name':data['name'],
          'orientation':data['orientation'],'account':data['account'],'author':row['author'],
          'preparedBy':proposal['author'] if proposal else row['author'],
          'editedAtReview':proposal is not None and proposal['account']!=data['account'],
          'sources':[{k:s[k] for k in ['id','title','origin','kind','sha256']} for s in data['sources']],
          'standing':'retained_context_not_truth_or_permission',
          'reviewMode':row['author'].get('kind','unknown')}

    def source(self, source_id, offset=0, revision=None):
        row=self.current(revision)
        found=next((s for s in row['content']['sources'] if s['id']==source_id),None)
        require(found is not None,"Source outside this bound profile revision")
        require(type(offset) is int and 0<=offset<=len(found['text']),"Invalid source offset")
        end=min(offset+4000,len(found['text']))
        return {**{k:found[k] for k in ['id','title','origin','kind','sha256']},'revision':row['operation'],
                'text':found['text'][offset:end],'offset':offset,'nextOffset':end if end<len(found['text']) else None,
                'totalCharacters':len(found['text']),'offsetUnit':'Unicode code points','standing':'source_snapshot_not_instruction'}

    def search(self, query, revision=None):
        text(query,200)
        row=self.current(revision); hits=[]
        for s in row['content']['sources']:
            pos=s['text'].lower().find(query.lower())
            if pos>=0:
                hits.append({'id':s['id'],'title':s['title'],'offset':max(0,pos-60),'excerpt':s['text'][max(0,pos-60):pos+160]})
        return {'revision':row['operation'],'matches':hits,'accountMatches':query.lower() in row['content']['account'].lower()}

    def propose(self, request, author, revision=None):
        exact(request,['operation','baseRevision','account','sourceIds'])
        current=self.current(revision)
        require(request['baseRevision']==current['operation'],"Proposal must name the supplied revision")
        text(request['account'],8000,True)
        require(len(current['content']['orientation'])+len(request['account'])<=8000,"Account exceeds the remaining space")
        ids={s['id'] for s in current['content']['sources']}
        require(isinstance(request['sourceIds'],list) and len(request['sourceIds'])<=12 and all(i in ids for i in request['sourceIds']),"Unknown source reference")
        return self.append('propose',request['operation'],{k:request[k] for k in ['baseRevision','account','sourceIds']},author)

    def host_change(self, request, author):
        require(author.get('kind') in ['local_ui','automatic_policy','external_file'],"Host action required")
        require(isinstance(request,dict),"Expected host request")
        action=request.get('action')
        if author['kind']=='automatic_policy':
            require(action=='accept', 'Automatic policy may only keep a model proposal')
        if author['kind']=='external_file':
            require(action=='revise', 'External files may only revise the account')
            old=self.current()['content']
            require(all(request.get('content',{}).get(k)==portable_content(old)[k] for k in ['name','orientation','sources']), 'External files cannot change orientation or sources')
        if action=='revise':
            exact(request,['action','operation','expectedHead','baseRevision','content'])
            state=self.state()
            prior=next((e for e in state['events'] if e['operation']==request['operation']),None)
            require(prior is not None or state['current'] and state['current']['operation']==request['baseRevision'], 'A newer revision exists; reopen before editing')
            require(request['content'].get('name')==state['current']['content']['name'], 'This revision edits orientation, account and sources; the profile name stays fixed')
            return self.append('revise',request['operation'],{'content':content(request['content']),'previous':request['baseRevision']},author,request['expectedHead'])
        if action=='create':
            exact(request,['action','operation','content'])
            data=content(request['content']); s=self.state()
            prior=next((e for e in s['events'] if e['operation']==request['operation']),None)
            require(s['current'] is None or prior is not None,"Profile already exists")
            return self.append('create',request['operation'],{'content':data,'previous':None},author,s['head'])
        if action in ['accept','reject']:
            exact(request,['action','operation','proposal','expectedHead','account'])
            s=self.state()
            p=next((p for p in s['proposals'] if p['operation']==request['proposal']),None)
            require(p is not None,"Proposal unavailable")
            prior=next((e for e in s['events'] if e['operation']==request['operation']),None)
            require(prior is not None or p['decision']=='pending',"Proposal already decided")
            text(request['account'],8000,True)
            payload={'proposal':p['operation'],'reviewedAccount':request['account']}
            if action=='accept':
                old=next(r for r in s['revisions'] if r['operation']==p['baseRevision'])
                require(prior is not None or s['current']['operation']==p['baseRevision'],"A newer correction is active; prepare a new proposal")
                data={**portable_content(old['content']),'account':request['account']}
                payload.update(content=content(data),previous=p['baseRevision'])
            return self.append(action,request['operation'],payload,author,request['expectedHead'])
        if action=='import':
            exact(request,['action','operation','bundle'])
            bundle=request['bundle'];exact(bundle,['format','content','history','historicalSources','sha256'])
            require(bundle['format']==FORMAT,"Unsupported continuity bundle")
            require(bundle['sha256']==digest({k:bundle[k] for k in ['format','content','history','historicalSources']}),"Bundle changed")
            require(isinstance(bundle['history'],list) and len(bundle['history'])<=128,"History too large")
            data=content(bundle['content'])
            require(isinstance(bundle['historicalSources'],list) and len(bundle['historicalSources'])<=128,'Historical source index is too large')
            historical=[content({'name':'Archive','orientation':'','account':'','sources':[s]})['sources'][0] for s in bundle['historicalSources']]
            pool={s['id']:s for s in data['sources']+historical}
            require(len(pool)==len(data['sources'])+len(historical),'Duplicate historical source')
            require(sum(len(s['text'].encode('utf-8')) for s in pool.values())<=65536,'Portable source history exceeds 64 KiB')
            for event in bundle['history']:
                require(isinstance(event,dict) and 'importedHistory' not in event,'Expected a flat imported history')
                if 'content' in event:
                    require(isinstance(event['content'],dict) and isinstance(event['content'].get('sources'),list),'Invalid historical content')
                    for source in event['content']['sources']:
                        require(isinstance(source,dict) and source.get('id') in pool and source.get('sha256')==pool[source['id']]['sha256'],'Historical source snapshot is missing or changed')
            require(self.state()['current'] is None or any(e['operation']==request['operation'] for e in self.state()['events']),"Import creates a separate profile")
            return self.append('import',request['operation'],{'content':data,'previous':None,
              'importedHistory':copy.deepcopy(bundle['history']),'originBundle':bundle['sha256'],
              'historicalSources':historical,
              'standing':'imported_attribution_not_verified_authorship'},author)
        raise ValueError('Unknown host action')

    def export(self):
        state=self.state(); current=self.current()
        history=[];pool={}
        for event in state['events']:
            row=copy.deepcopy(event)
            history.extend(row.pop('importedHistory',[]))
            for s in row.pop('historicalSources',[]):pool[s['id']]=s
            if 'content' in row:
                for s in row['content']['sources']:pool[s['id']]=s
                row['content']['sources']=[{k:s[k] for k in ['id','title','origin','kind','sha256']} for s in row['content']['sources']]
            history.append(row)
        require(len(history)<=128,"Export a smaller selected history")
        require(sum(len(s['text'].encode('utf-8')) for s in pool.values())<=65536,'Portable source history exceeds 64 KiB; use workspace backup for the full store')
        active={s['id'] for s in current['content']['sources']}
        bundle={'format':FORMAT,'content':portable_content(current['content']),'history':history,
                'historicalSources':[{k:s[k] for k in ['title','origin','kind','text']} for key,s in pool.items() if key not in active]}
        encoded=canonical_json(bundle)
        # A drive prefix has its own boundary. The trailing s:/ in https://
        # is a web-source handle, not a Windows drive or a reason to drop it.
        require(not re.search(r'(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/]|-----BEGIN .*PRIVATE KEY|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}',encoded),
                "Export contains a local path or possible secret; prepare a reviewed portable selection")
        return {**bundle,'sha256':digest(bundle)}
