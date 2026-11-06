import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const groups=[];
const documents=[];
for(const [title,input,name] of [
 ['PEACHES Floor — Apache licence','server/peaches_runtime/vendor/LICENSE','PEACHES-LICENSE.txt'],
 ['PEACHES Floor — attribution','server/peaches_runtime/vendor/NOTICE','PEACHES-NOTICE.txt'],
 ['PEACHES Floor — licence coverage and retained H1 record','server/peaches_runtime/vendor/LICENSE-SCOPE.md','PEACHES-SCOPE.txt'],
 ['cryptography 50.0.1 — licence','.local/peaches-venv/Lib/site-packages/cryptography-50.0.1.dist-info/licenses/LICENSE','PEACHES-cryptography-LICENSE.txt'],
 ['cryptography — Apache terms','.local/peaches-venv/Lib/site-packages/cryptography-50.0.1.dist-info/licenses/LICENSE.APACHE','PEACHES-cryptography-APACHE.txt'],
 ['cryptography — BSD terms','.local/peaches-venv/Lib/site-packages/cryptography-50.0.1.dist-info/licenses/LICENSE.BSD','PEACHES-cryptography-BSD.txt'],
 ['bcrypt 5.0.0 — licence','.local/peaches-venv/Lib/site-packages/bcrypt-5.0.0.dist-info/LICENSE','PEACHES-bcrypt-LICENSE.txt'],
 ['cffi 2.1.1 — licence','.local/peaches-venv/Lib/site-packages/cffi-2.1.1.dist-info/licenses/LICENSE','PEACHES-cffi-LICENSE.txt'],
 ['pycparser 3.11 — licence','.local/peaches-venv/Lib/site-packages/pycparser-3.11.dist-info/licenses/LICENSE','PEACHES-pycparser-LICENSE.txt']]){
 const bytes=await fs.readFile(path.join(root,input));await fs.writeFile(path.join(root,'public/licenses',name),bytes);documents.push({title,file:name,source:input,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
const file=path.join(root,'public/licenses/index.json'),index=JSON.parse(await fs.readFile(file,'utf8'));
index.groups=index.groups.filter(g=>g.title!=='Book of PEACHES');index.groups.push({title:'Book of PEACHES',documents});
await fs.writeFile(file,JSON.stringify(index,null,2)+'\n');
console.log('Included offline PEACHES and signing-runtime notices.');
