"""Selected-byte extraction only; no document actions or external references."""
import base64, io, json, sys, zipfile, xml.etree.ElementTree as ET
sys.stdin.reconfigure(encoding='utf-8'); sys.stdout.reconfigure(encoding='utf-8')
LIMIT=1000000
def main():
 request=json.loads(sys.stdin.buffer.read(15*1024*1024))
 raw=base64.b64decode(request['base64'],validate=True)
 if not raw or len(raw)>10*1024*1024: raise ValueError('Choose a document up to 10 MiB.')
 kind=request['kind']; parts=[]; incomplete=False
 if kind=='pdf':
  import pypdf
  if pypdf.__version__!="6.21.1":raise ValueError("The qualified PDF reader version changed.")
  from pypdf import PdfReader
  if not raw.startswith(b'%PDF-'): raise ValueError('The file is not a PDF.')
  doc=PdfReader(io.BytesIO(raw),strict=True)
  if doc.is_encrypted: raise ValueError('Encrypted documents are not opened by this reader.')
  total=len(doc.pages)
  for i,page in enumerate(doc.pages[:100]):
   text=page.extract_text() or '[No extractable text on this page; it may require visual reading or OCR.]'
   parts.append(f'\n[Page {i+1}]\n{text}')
   if sum(len(x) for x in parts)>LIMIT: incomplete=True;break
  incomplete=incomplete or total>100
  source={'format':'pdf','pages':total,'pagesExtracted':len(parts),'parser':'pypdf-6.21.1','view':'text extraction; layout, diagrams and scanned text are not established'}
 elif kind=='docx':
  with zipfile.ZipFile(io.BytesIO(raw)) as doc:
   infos=doc.infolist()
   if len(infos)>3000 or sum(i.file_size for i in infos)>30*1024*1024: raise ValueError('The expanded document exceeds the reading limit.')
   if any(i.flag_bits&1 for i in infos): raise ValueError('Encrypted documents are not opened.')
   xml=doc.read('word/document.xml')
   if b'<!DOCTYPE' in xml or b'<!ENTITY' in xml: raise ValueError('Document entity declarations are unsupported.')
   root=ET.fromstring(xml);ns='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
   for paragraph in root.iter(ns+'p'):
    parts.append(''.join('\t' if e.tag==ns+'tab' else '\n' if e.tag==ns+'br' else e.text or '' for e in paragraph.iter() if e.tag in (ns+'t',ns+'tab',ns+'br')))
   source={'format':'docx','parser':'stdlib-zip-xml','view':'main document paragraphs and table text; images, comments, headers, footers and layout are not extracted'}
 else: raise ValueError('Choose PDF or DOCX.')
 text='\n'.join(parts)
 incomplete=incomplete or len(text)>LIMIT
 print(json.dumps({'text':text[:LIMIT], 'source':source, 'truncated':incomplete},ensure_ascii=False))
try:main()
except Exception as e:
 print(json.dumps({'error':str(e)[:300]},ensure_ascii=False));sys.exit(1)
