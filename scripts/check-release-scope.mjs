import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const manifest=JSON.parse(fs.readFileSync('marketing/release-manifest.json','utf8'));
const files=execFileSync('git',['ls-tree','-r','--name-only',manifest.base],{encoding:'utf8'}).trim().split('\n');
const protectedFiles=files.filter(f=>f.endsWith('.js')||['wallet.html','fran-connect.html','privacy.html','terms.html','CNAME','.nojekyll','robots.txt'].includes(f));
for(const f of protectedFiles)assert.deepEqual(fs.readFileSync(f),execFileSync('git',['show',manifest.base+':'+f]),f+' changed');
const changed=execFileSync('git',['diff','--name-only',manifest.base],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const existingAllowed=new Set(manifest.existing_files_allowed.filter(f=>!f.includes('*')));
for(const f of changed){const allowed=existingAllowed.has(f)||/^guides\/[^/]+\.md$/.test(f)||[...manifest.new_public_paths,...manifest.new_authoring_paths].some(p=>p.endsWith('/')?f.startsWith(p):f===p);assert.ok(allowed,'Outside release scope: '+f);}
console.log(`Release scope verified: ${protectedFiles.length} protected production files unchanged; ${changed.length} reviewed paths.`);
