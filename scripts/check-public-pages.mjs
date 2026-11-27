import fs from 'node:fs';
const origin=(process.argv[2]||'https://franwallet.com').replace(/\/$/,'');
const data=JSON.parse(fs.readFileSync(new URL('../marketing/content.json',import.meta.url),'utf8'));
const routes=['/insights/',...data.pages.map(p=>'/'+p.slug+'/')];
let failures=0;
for(let i=0;i<routes.length;i+=4){await Promise.all(routes.slice(i,i+4).map(async route=>{try{const response=await fetch(origin+route,{signal:AbortSignal.timeout(20000)});const body=await response.text();if(!response.ok||!body.includes('href="https://franwallet.com'+route+'"')||!body.includes('content="index,follow"')||!body.includes('<h1>'))throw Error('HTTP '+response.status+' or missing canonical/content');console.log('PASS '+route);}catch(e){failures++;console.error('FAIL '+route+': '+e.message);}}));}
console.log(`${routes.length-failures}/${routes.length} public pages verified.`);process.exitCode=failures?1:0;
