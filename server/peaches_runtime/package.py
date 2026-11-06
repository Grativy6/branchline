"""Bounded, in-memory Branchline containers. No extraction, network or key access."""
import base64
import hashlib
import io
import json
import re
import stat
import zipfile
from vendor.floor import strict_json_loads, verify_floor_stamp

LIMIT = 1024 * 1024
MEMBERS = {'continuity.json', 'manifest.json', 'stamp.floor.json', 'origin.floor.json', 'README.txt'}
REQUIRED = {'continuity.json', 'manifest.json', 'README.txt'}
HEX = re.compile(r'^[a-f0-9]{64}$')
README = ('Book of PEACHES - Branchline continuity copy\n\n'
          'This package contains readable personal material. A signature does not encrypt it.\n'
          'continuity.json retains the reviewed account, sources and original attribution.\n'
          'manifest.json declares lineage and exact payload digests. An optional stamp signs those exact manifest bytes.\n'
          'origin.floor.json, when included, is a separate historical origin declaration.\n'
          'A valid signature checks the presented key and bytes, not the truth of the account or a permission grant.\n'
          'Import into Branchline creates a separate local profile and transfers no tool or provider permissions.\n'
          'This guide is supporting text and is not part of the signed declaration.\n').encode()

def require(ok, message):
    if not ok:
        raise ValueError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def decode(value, limit=LIMIT):
    require(isinstance(value, str) and len(value) <= ((limit + 2)//3)*4, 'Oversized encoded copy.')
    data = base64.b64decode(value, validate=True)
    require(len(data) <= limit and base64.b64encode(data).decode() == value, 'Invalid encoded copy.')
    return data

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')

def checked_stamp(data):
    # Preserve received bytes. Strict parser rejects duplicate fields before the checker.
    value = strict_json_loads(data)
    result = verify_floor_stamp(value)
    require(result['status'] == 'VALID_FLOOR_STRUCTURE_AND_SIGNATURE', 'Could not check signature: ' + ', '.join(result['errors']))
    return value, {**result, 'envelopeSha256': sha(data)}

def inspect_files(files):
    require(isinstance(files, dict) and set(files) <= MEMBERS, 'Unexpected package members.')
    require(REQUIRED <= set(files), 'Sources incomplete: required package members are missing.')
    require(sum(map(len, files.values())) <= LIMIT, 'Expanded copy exceeds 1 MiB.')
    for value in files.values():
        value.decode('utf-8', errors='strict')
    manifest = strict_json_loads(files['manifest.json'])
    require(isinstance(manifest, dict) and set(manifest) == {'schema','title','createdAt','thread','source','payloads','parent','relation'}, 'Unsupported snapshot fields.')
    require(manifest['schema'] == 'branchline.peach/1', 'Unsupported snapshot format.')
    require(isinstance(manifest['title'], str) and 0 < len(manifest['title']) <= 200, 'Invalid snapshot title.')
    require(isinstance(manifest['createdAt'], str) and len(manifest['createdAt']) <= 40, 'Invalid snapshot date.')
    require(manifest['relation'] in ['checkpoint','correction','continuation','branch'], 'Unknown snapshot relationship.')
    require(manifest['parent'] is None or isinstance(manifest['parent'], str) and HEX.fullmatch(manifest['parent']), 'Invalid parent digest.')
    thread = manifest['thread']
    require(isinstance(thread, dict) and set(thread) == {'id','origin','predecessors'}, 'Invalid continuing-thread reference.')
    require(isinstance(thread['id'], str) and re.fullmatch(r'thread_[a-f0-9-]{36}', thread['id']), 'Invalid thread identity.')
    require(isinstance(thread['predecessors'], list) and len(thread['predecessors']) <= 64, 'Too many predecessor links.')
    source = manifest['source']
    require(isinstance(source, dict) and set(source) == {'workspace','participant','profile','revision','generation','adoptedBy'}, 'Invalid snapshot source.')
    for key in ['workspace','profile','revision','adoptedBy']:
        require(isinstance(source[key], str) and 0 < len(source[key]) <= 200, 'Invalid source '+key+'.')
    require(source['participant'] is None or isinstance(source['participant'], dict) and set(source['participant']) == {'id','name'}, 'Invalid Personal reference.')
    require(source['generation'] is None or isinstance(source['generation'], dict), 'Invalid generation reference.')
    payloads = manifest['payloads']
    expected = {'continuity.json'} | ({'origin.floor.json'} if thread['origin'] else set())
    require(isinstance(payloads, dict) and set(payloads) == expected, 'Invalid payload list.')
    for name, info in payloads.items():
        require(name in files, 'Sources incomplete: '+name+' is missing.')
        require(isinstance(info, dict) and set(info) == {'sha256','bytes'} and type(info['bytes']) is int, 'Invalid payload metadata.')
        require(info['bytes'] == len(files[name]) and info['sha256'] == sha(files[name]), 'Changed contents: '+name+'.')
    require(('origin.floor.json' in files) == bool(thread['origin']), 'Unexpected origin envelope.')
    bundle = strict_json_loads(files['continuity.json'])
    require(isinstance(bundle, dict) and set(bundle) == {'format','content','history','historicalSources','sha256'}, 'Invalid continuity export.')
    require(bundle['format'] == 'hearthline.personal-context/1', 'Unsupported continuity format.')
    payload = {k:v for k,v in bundle.items() if k != 'sha256'}
    require(sha(canonical(payload)) == bundle['sha256'], 'Changed contents: continuity export digest.')
    content = bundle['content']
    require(isinstance(content, dict) and set(content) == {'name','orientation','account','sources'}, 'Invalid reviewed account.')
    require(all(isinstance(content[k], str) for k in ['name','orientation','account']), 'Invalid account text.')
    require(len(content['name']) <= 120 and len(content['orientation']) + len(content['account']) <= 8000, 'Account exceeds the continuity limit.')
    require(isinstance(content['sources'], list) and len(content['sources']) <= 12, 'Too many active sources.')
    require(isinstance(bundle['history'], list) and len(bundle['history']) <= 128, 'Too much exported history.')
    require(isinstance(bundle['historicalSources'], list) and len(bundle['historicalSources']) <= 128, 'Invalid source history.')
    sources = content['sources'] + bundle['historicalSources']
    for item in sources:
        require(isinstance(item, dict) and set(item) == {'title','origin','kind','text'} and all(isinstance(v,str) for v in item.values()), 'Invalid source snapshot.')
        require(0<len(item['title'])<=200 and 0<len(item['origin'])<=500 and item['kind'] in ['reference','fiction','conversation','interpretation'] and item['text'].strip(), 'Invalid source description.')
    pool={'S'+sha(canonical(s))[:32]:sha(canonical(s)) for s in sources}
    require(len(pool)==len(sources), 'Duplicate source snapshot.')
    for event in bundle['history']:
        require(isinstance(event,dict) and 'importedHistory' not in event, 'Expected flat imported history.')
        if 'content' in event:
            require(isinstance(event['content'],dict) and isinstance(event['content'].get('sources'),list), 'Invalid historical content.')
            for src in event['content']['sources']:
                require(isinstance(src,dict) and src.get('id') in pool and src.get('sha256')==pool[src['id']], 'Sources incomplete: a historical source snapshot is missing or changed.')
    require(sum(len(s['text'].encode('utf-8')) for s in sources) <= 65536, 'Source history exceeds 64 KiB.')
    require(len(canonical(bundle).decode('utf-8')) <= 100000, 'Portable continuity exceeds its record limit.')
    origin = signature = None
    if thread['origin']:
        value, origin = checked_stamp(files['origin.floor.json'])
        ref = thread['origin']
        require(isinstance(ref,dict) and set(ref)=={'label','stampId','envelopeSha256','issuerId'}, 'Invalid origin reference.')
        require(ref['stampId']==origin['stamp_id'] and ref['envelopeSha256']==origin['envelopeSha256'] and ref['issuerId']==origin['issuer_id'], 'Changed contents: origin reference.')
    if 'stamp.floor.json' in files:
        value, signature = checked_stamp(files['stamp.floor.json'])
        declaration = value['declaration']
        raw = base64.urlsafe_b64decode(declaration['bytes'] + '='*((-len(declaration['bytes']))%4))
        require(raw == files['manifest.json'], 'Changed contents: signed declaration and displayed snapshot differ.')
    return {'manifest':manifest, 'bundle':bundle, 'snapshotSha256':sha(files['manifest.json']),
            'payloadSha256':sha(files['continuity.json']), 'signature':signature, 'origin':origin,
            'signerMatchesOrigin':bool(signature and origin and signature['issuer_id']==origin['issuer_id']),
            'status':'Signature checked' if signature else 'Saved locally', 'expandedBytes':sum(map(len,files.values()))}

def pack(files):
    inspect_files(files)
    out = io.BytesIO()
    with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name in sorted(files):
            item=zipfile.ZipInfo(name, (2026,1,1,0,0,0)); item.compress_type=zipfile.ZIP_DEFLATED
            item.external_attr=(stat.S_IFREG|0o600)<<16
            z.writestr(item,files[name])
    data=out.getvalue(); require(len(data)<=LIMIT,'Copy exceeds 1 MiB.')
    return data

def unpack(data):
    require(isinstance(data,bytes) and 0 < len(data) <= LIMIT, 'Copy exceeds 1 MiB.')
    require(data[:4]==b'PK\x03\x04', 'Choose a .peach.zip copy.')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        infos=z.infolist(); names=[i.filename for i in infos]
        require(len(infos)<=len(MEMBERS) and len(set(n.lower() for n in names))==len(names), 'Duplicate or unexpected members.')
        require(set(names)<=MEMBERS and not z.comment, 'Unexpected paths or archive comment.')
        require(sum(i.file_size for i in infos)<=LIMIT, 'Expanded copy exceeds 1 MiB.')
        require(sum(i.compress_size for i in infos)<=LIMIT, 'Oversized compressed copy.')
        files={}
        for i in infos:
            kind=stat.S_IFMT(i.external_attr>>16)
            require(kind in [0,stat.S_IFREG] and not i.is_dir() and not i.flag_bits&1, 'Links, directories and encrypted archives are unsupported.')
            require(i.compress_type in [zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED], 'Unsupported compression.')
            require(not i.extra and not i.comment, 'Unexpected member metadata.')
            with z.open(i) as entry:
                value=entry.read(min(LIMIT,i.file_size)+1)
            require(len(value)==i.file_size, 'Changed contents: archive size.')
            files[i.filename]=value
    return files
