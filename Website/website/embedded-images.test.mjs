import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {externaliseImages} from '../embedded-images.mjs';

test('external images preserve exact image bytes and attributes without changing inline CMS defaults',()=>{
 const original=readFileSync(new URL('./index.html',import.meta.url),'utf8'),files=new Map();
 const output=externaliseImages(original,(name,bytes)=>files.set(name,bytes));
 const images=[...original.matchAll(/<img\b[^>]*src="data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)"[^>]*>/g)];
 assert.equal(images.length,4);assert.equal(files.size,4);
 for(const [name,bytes] of files){assert(images.some(m=>Buffer.from(m[2],'base64').equals(bytes)));assert(output.includes('/'+name));}
 assert(!/<img\b[^>]*src="data:image/.test(output));
 assert.equal(output.slice(output.indexOf('const CMS_MODEL=')),original.slice(original.indexOf('const CMS_MODEL=')));
 assert.equal((output.match(/loading="lazy"/g)||[]).length,(original.match(/loading="lazy"/g)||[]).length);
 assert(Buffer.byteLength(output)<350000);
});
test('ordinary URLs and non-image data are untouched; identical images emit deterministic paths',()=>{
 const html='<img src="/ordinary.png"><img src="data:image/png;base64,YWJj"><img src="data:image/png;base64,YWJj"><script>const logo="data:image/png;base64,YWJj";</script>';
 const names=[];const output=externaliseImages(html,name=>names.push(name));
 assert.equal(names[0],names[1]);assert(output.includes('<img src="/ordinary.png">'));assert(output.includes('const logo="data:image/png;base64,YWJj"'));
});
