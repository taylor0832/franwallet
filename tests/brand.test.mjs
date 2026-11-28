import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const htmlFiles=fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.html')&&!p.startsWith('.git/')&&!p.startsWith('node_modules/')&&!p.includes('brand-preview-local'));
test('every site page declares the approved favicon, app icon and shared brand stylesheet',()=>{
 for(const p of htmlFiles){const head=read(p).match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1];assert.ok(head,p+' has a head');
  for(const href of ['/favicon.svg?v=20261128-layered','/favicon-32x32.png?v=20261128-layered','/apple-touch-icon.png?v=20261128-layered','/fran-brand.css?v=20261128-layered'])assert.ok(head.includes(href),p+' missing '+href);
  assert.equal((head.match(/href="\/fran-brand\.css/g)||[]).length,1,p+' duplicates brand CSS');
 }
});
test('full icon and navbar preserve the same approved wallet curves and palette',()=>{
 const master=read('assets/brand/franwallet-icon.svg');const nav=read('assets/brand/franwallet-nav.svg');
 assert.equal(crypto.createHash('sha256').update(master).digest('hex'),'95b9aac446cde2ddae86b43b45dc7d57684d58eaf5796fde3b063022573a7414');
 assert.equal(read('favicon.svg'),master);
 const paths=s=>[...s.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(paths(nav),paths(master));
 assert.match(nav,/viewBox="30 44 202 168"/);for(const color of ['#0A3D3D','#E8734A','#FFFFFF'])assert.ok(master.includes(color));
});
test('brand fonts are the original website families and are served locally',()=>{
 const css=read('fran-brand.css');assert.match(css,/font-family:Fraunces/);assert.match(css,/font-family:'DM Sans'/);assert.match(css,/font-weight:700!important/);
 for(const name of ['Fraunces-variable.ttf','DM-Sans-variable.ttf'])assert.ok(fs.statSync(path.join(root,'assets/brand/fonts',name)).size>10000);
 for(const i of JSON.parse(read('site.webmanifest')).icons)assert.ok(fs.existsSync(path.join(root,i.src.split('?')[0])));
});
test('portable exported documents no longer embed the retired F mark',()=>{
 for(const p of ['index.html','wallet.html','r.html','privacy.html','terms.html','fran-showcase.css'])assert.doesNotMatch(read(p),/M18(?: |%20)13(?: |%20)H46/,p);
});
test('bundled animation retains a valid template and the approved avatar',async()=>{
 const html=read('fran-launch-video.html');const payload=html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1];const template=JSON.parse(payload);assert.match(template,/fran-brand\.css/);assert.match(template,/favicon\.svg/);
 const {gunzipSync}=await import('node:zlib');const manifest=JSON.parse(html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/)[1]);const entry=manifest['bf8430a0-f8c7-414b-814c-a7510071208c'];const code=gunzipSync(Buffer.from(entry.data,'base64')).toString();assert.match(code,/function FranAvatar[\s\S]*?franwallet-icon\.svg/);assert.doesNotMatch(code,/function FranAvatar[\s\S]*?\}>F<\/div>/);
});
