import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(new URL('../marketing/indexnow.json',import.meta.url),'utf8'));
const origin='https://'+config.host;
const key=fs.readFileSync(new URL('../'+config.keyFile,import.meta.url),'utf8').trim();
const sitemap=fs.readFileSync(new URL('../sitemap.xml',import.meta.url),'utf8');
const urls=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
const keyLocation=origin+'/'+config.keyFile;
if(process.argv[2]!=='--submit'){console.log(`Ready to notify IndexNow about ${urls.length} canonical public URLs. Run with --submit after deployment.`);process.exit(0);}
const proof=await fetch(keyLocation,{signal:AbortSignal.timeout(20000)});
if(!proof.ok||(await proof.text()).trim()!==key)throw Error('Published ownership file not verified; no submission sent.');
const response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({host:config.host,key,keyLocation,urlList:urls}),signal:AbortSignal.timeout(30000)});
console.log(JSON.stringify({status:response.status,submitted:urls.length,result:response.status===200?'Received; indexing and placement are not guaranteed':response.status===202?'Received; key validation pending':await response.text()}));
if(![200,202].includes(response.status))process.exitCode=1;
