import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version='20261128-layered';
const head=`<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=${version}"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=${version}"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${version}"><link rel="manifest" href="/site.webmanifest?v=${version}"><link rel="stylesheet" href="/fran-brand.css?v=${version}">`;
const linkTag=/<link\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const attrs=(s,k)=>s.match(new RegExp('\\b'+k+'\\s*=\\s*["\']([^"\']*)["\']','i'))?.[1]||'';
const master=fs.readFileSync(path.join(root,'assets/brand/franwallet-icon.svg'),'utf8').trim();
const markUri='data:image/svg+xml;utf8,'+encodeURIComponent(master);
const oldMark=/(?:M18 13 H46|M18%2013|M77 55h109|M79 56h107)/;
function headBrand(html){return html.replace(/<head\b[^>]*>([\s\S]*?)<\/head>/i,(_,inner)=>'<head>'+inner.replace(linkTag,t=>/^(?:icon|shortcut icon|apple-touch-icon|manifest)$/i.test(attrs(t,'rel'))||attrs(t,'href').includes('fran-brand.css')?'':t)+head+'</head>');}
function brandMarkup(html){
 return html
  .replace(/<(span|div)([^>]*\bclass=["'](?:mark|mt-mark|pf-mark|sx-mark|agent-avatar|fj-avatar|ld-av)["'][^>]*)>\s*F\.?\s*<\/(?:span|div)>/g,(_,tag,a)=>`<${tag}${a.includes('class="mark"')?a.replace('class="mark"','class="mark fran-brand-slot"'):a}></${tag}>`)
  .replace(/<span class="setup-wordmark">F\. /g,'<span class="setup-wordmark">')
  .replace(/(<span class="(?:fj-brand|ld-title)"><b>)F\.(<\/b>)/g,'$1$2')
  .replace(/(<(?:span|div) class="mark")>(\s*<svg\b[\s\S]*?<\/svg>\s*)<\/(span|div)>/g,(full,start,svg,tag)=>oldMark.test(svg)?`${start.replace('class="mark"','class="mark fran-brand-slot"')}></${tag}>`:full);
}
let count=0;
function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules','assets'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(e.name.endsWith('.html')){const old=fs.readFileSync(p,'utf8');let html=headBrand(old);
  html=html.replace(/(https:\/\/franwallet\.com\/(?:og-image\.png|og-wallet\.png|media\/franwallet-new-owner-poster(?:-hook)?\.jpg))(?:\?v=[^"'<>\s]*)?/g,'$1?v='+version);
  if(e.name==='r.html')html=html.replace('<span class="mark"></span>','');
  if(e.name==='skills.html')html=html.replace('FranWallet<span class="dot"></span></a>','FranWallet</a>');
  if(e.name==='support.html')html=html.replace(/(?:Fraunces,)*Georgia,serif/g,'Fraunces,Georgia,serif').replace('font:16px/1.6 system-ui','font:16px/1.6 "DM Sans",system-ui');html=html.replace(/url\((["'])data:image\/svg\+xml;utf8,([\s\S]*?)\1\)/g,(full,q,svg)=>oldMark.test(svg)?`url("${markUri}")`:full);html=brandMarkup(html);
  html=html.replace(/((?:src|poster)=["'](?:\/)?(?:fran-product-(?:books|wallet|debt)\.png|media\/franwallet-new-owner(?:-720)?\.mp4|media\/franwallet-new-owner-poster(?:-hook)?\.jpg))(?:\?v=[^"']*)?(["'])/g,'$1?v='+version+'$2');
  // Brand only FranWallet anchors. CoverPanda and provider identities retain theirs.
  // Keep breadcrumbs and footer text links compact; only actual brand anchors get the mark.
  html=html.replace(/<a\b([^>]*?)>(FranWallet|Fran<span>Wallet<\/span>)<\/a>/g,(full,a,label)=>{
   const named=/class=["'][^"']*\bbrand\b/.test(a);
   const standalone=['fran-connect.html','room.html'].includes(e.name);
   if(!named&&!standalone)return full;
   if(a.includes('fran-brand-link'))return full;
   const amended=/class=["']/.test(a)?a.replace(/class=(["'])/,'class=$1fran-brand-link '):a+' class="fran-brand-link"';
   return '<a'+amended+'><img class="fran-brand-inline" src="/assets/brand/franwallet-icon.svg" width="36" height="36" alt="">'+label+'</a>';
  });
  if(html!==old){fs.writeFileSync(p,html);count++;}
 }} }
visit(root);
console.log(`Brand metadata and approved wallet applied to ${count} HTML files.`);
