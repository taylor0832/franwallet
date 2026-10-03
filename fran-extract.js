/* Reads key details from a document the owner just added: company formation papers and EIN letters,
   leases, and loan documents. Runs in the browser on text the owner's own file contains; nothing is
   sent anywhere to do it. Every value carries the line it came from, and nothing is saved until the
   owner reviews it. The loan schedule is calculated from the amount, rate and term, and labeled so. */
(function(root){'use strict'
const MONTHS={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11}
const STATES={alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE','district of columbia':'DC',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY'}
const WORDS={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,fifteen:15,twenty:20,'twenty-five':25,thirty:30}
const iso=(y,m,d)=>{const t=new Date(Date.UTC(y,m,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m&&t.getUTCDate()===d?t.toISOString().slice(0,10):''}
/* Dates as written in agreements: March 1, 2027 · 1st day of March, 2027 · 03/01/2027 · 2027-03-01 */
const DATE_RE=/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+day\s+of\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i
function parseDate(s){if(!s)return '';s=String(s).trim();let m
 if(m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/))return iso(+m[1],+m[2]-1,+m[3])
 if(m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))return iso(+m[3],+m[1]-1,+m[2])
 if(m=s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([a-z]+),?\s+(\d{4})$/i))return MONTHS[m[2].toLowerCase()]!==undefined?iso(+m[3],MONTHS[m[2].toLowerCase()],+m[1]):''
 if(m=s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i))return MONTHS[m[1].toLowerCase()]!==undefined?iso(+m[3],MONTHS[m[1].toLowerCase()],+m[2]):''
 return ''}
const money=s=>{const n=Number(String(s).replace(/[$,\s]/g,''));return Number.isFinite(n)?n:null}
const MONEY='\\$\\s?([\\d,]+(?:\\.\\d{1,2})?)'
function norm(text){return String(text||'').replace(/\r/g,'').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[ \t ]+/g,' ')}
/* The sentence or line a value came from, trimmed for display. */
function evidence(text,index,len){const start=Math.max(0,text.lastIndexOf('\n',index)+1,index-90),end=Math.min(text.length,(text.indexOf('\n',index+len)+1||text.length+1)-1,index+len+90);return (start>0&&text[start-1]!=='\n'?'…':'')+text.slice(start,end).trim()+(end<text.length&&text[end]!=='\n'?'…':'')}
function find(text,re,group=1,map=x=>x){const m=re.exec(text);if(!m)return null;const raw=m[group];if(raw==null)return null;const value=map(raw.trim());if(value===''||value==null)return null;return {value,evidence:evidence(text,m.index,m[0].length)}}
const clean=s=>String(s||'').replace(/\s+/g,' ').replace(/^[\s,:;.-]+|[\s,;:-]+$/g,'').replace(/^(?:the|by and between|between)\s+/i,'').trim()
/* A party name from a recital: keep what follows the last "between / by / and". */
const party=s=>{s=clean(s);const parts=s.split(/\b(?:by and between|between|made by|by|and)\s+/i);return clean(parts[parts.length-1])}
const isName=s=>!!s&&s.length>=2&&s.length<=120&&/[a-z]/i.test(s)&&!/^(?:landlord|tenant|lessor|lessee|lender|borrower|the|this|such|said)$/i.test(s)
function termMonths(s){if(!s)return null;s=s.toLowerCase();let m
 if(m=s.match(/\((\d{1,3})\)\s*(year|month)/))return +m[1]*(m[2]==='year'?12:1)
 if(m=s.match(/(\d{1,3})\s*(?:-|\s)?\s*(year|month)/))return +m[1]*(m[2]==='year'?12:1)
 if(m=s.match(/([a-z-]+)\s*(year|month)/))return WORDS[m[1]]?WORDS[m[1]]*(m[2]==='year'?12:1):null
 return null}
const addMonths=(isoDate,n)=>{const d=new Date(isoDate+'T00:00:00Z');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10)}
const dayBefore=isoDate=>{const d=new Date(isoDate+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
const EMAIL=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,PHONE=/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
/* Contact details near a party's notice block. */
function contactNear(text,label){const re=new RegExp('(?:'+label+')[^\\n]{0,40}(?:notice|attention|attn|contact|address|at)?[:\\s]','ig');let best=null,m
 while((m=re.exec(text))){const block=text.slice(m.index,m.index+420),email=block.match(EMAIL),phone=block.match(PHONE),attn=[...block.matchAll(/(?:attn|attention|contact|loan officer|relationship manager|property manager)\s*[:.]?\s*(?:(?:loan officer|relationship manager|property manager)\s*[:,.]?\s*)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/gi)].find(x=>!/^(?:loan officer|relationship manager|property manager|contact|attention|attn|lender|landlord)\b/i.test(x[1]))
  const score=(email?2:0)+(phone?1:0)+(attn?1:0);if(score&&(!best||score>best.score)){/* Cite the line the contact itself is on, not the label that led there. */const at=[attn?.index,email?.index,phone?.index].filter(x=>Number.isFinite(x)).sort((a,b)=>a-b)[0]??0;best={score,email:email?.[0]||'',phone:phone?.[0]||'',name:attn?.[1]||'',evidence:evidence(text,m.index+at,Math.min(block.length-at,120))}}}
 return best}

/* ---------- what kind of document is this ---------- */
function detect(text,name){const s=(String(name||'')+' '+norm(text).slice(0,12000)).toLowerCase()
 const score={
  loan:(/promissory note|loan agreement|term loan|sba (?:7\(a\)|504)|note date|borrower/.test(s)?2:0)+(/lender/.test(s)?1:0)+(/interest rate|per annum|maturity date|amortiz/.test(s)?1:0),
  lease:(/lease agreement|commercial lease|retail lease|shopping center lease|lease/.test(s)?2:0)+(/landlord|lessor/.test(s)?1:0)+(/tenant|lessee|premises|base rent|minimum rent/.test(s)?1:0),
  entity:(/articles of organization|certificate of formation|articles of incorporation|operating agreement|partnership agreement|employer identification number|\bein\b|cp ?575|bylaws/.test(s)?2:0)+(/member|shareholder|partner|managing member/.test(s)?1:0)}
 const best=Object.entries(score).sort((a,b)=>b[1]-a[1])[0];return best[1]>=2?best[0]:null}

/* ---------- company: name, type, state, EIN, date, owners ---------- */
function entityPass(t){const out={}
 out.ein=find(t,/(?:employer identification number|\bEIN\b|federal tax(?:payer)? (?:id|identification) (?:number|no\.?))[^0-9]{0,60}(\d{2}-\d{7})/i)||find(t,/\b(\d{2}-\d{7})\b/)
 out.name=find(t,/(?:the name of the (?:limited liability company|company|corporation|partnership) is|operating agreement of|partnership agreement of|articles of organization of|certificate of formation of)\s*:?\s*"?([A-Z0-9][A-Za-z0-9&.,' -]{2,100}?(?:,?\s+(?:LLC|L\.L\.C\.|Inc\.?|Corporation|Corp\.?|LP|LLP|L\.P\.|Co\.)))/i,1,clean)
  ||find(t,/\b([A-Z0-9][A-Za-z0-9&.' -]{2,80}?,?\s+(?:LLC|L\.L\.C\.|Inc\.|Corporation|LLP|LP))\b/,1,clean)
 const type=out.name?.value||'';const kind=/\bL\.?L\.?C\.?\b|limited liability company/i.test(type+' '+t.slice(0,3000))?'LLC':/\b(?:inc|corp|corporation)\b/i.test(type)||/articles of incorporation/i.test(t)?'Corporation':/partnership/i.test(t.slice(0,3000))?'Partnership':''
 if(kind)out.entity_type={value:kind,evidence:out.name?.evidence||''}
 /* Formation state: a known state name followed by the entity type, or an explicit "laws of the State of". */
 const stateNames=Object.keys(STATES).sort((a,b)=>b.length-a.length).join('|')
 out.jurisdiction=find(t,new RegExp('\\b('+stateNames+')\\s+(?:limited liability company|corporation|limited partnership|general partnership|nonprofit corporation)','i'),1,x=>STATES[x.toLowerCase()]||'')
  ||find(t,new RegExp('(?:laws of the state of|state of organization|secretary of state of|state of formation)\\s*:?\\s*('+stateNames+')','i'),1,x=>STATES[x.toLowerCase()]||'')
 out.effective_date=find(t,new RegExp('(?:effective date|date of formation|formation date|date filed|filed on|dated as of|made and entered into as of|is entered into as of)[^\\n]{0,30}?'+DATE_RE.source,'i'),1,parseDate)
 // Owners: member / partner / shareholder tables and lists with ownership percentages.
 const owners=[],seen=new Set();const ownerRe=/(?:^|\n|;|,|•|-)\s*(?:member|partner|shareholder|owner)?\s*:?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}|[A-Z][A-Za-z0-9&.' -]{2,60}?,?\s+(?:LLC|Inc\.|LP|Trust))\s*(?:\(|\||-|–|:|,|\.{2,}|\s{2,}|\t)?\s*(?:[^\n%]{0,60}?)(\d{1,3}(?:\.\d{1,2})?)\s*%/g;let m
 const section=(()=>{const i=t.search(/schedule a|exhibit a|members? and (?:their )?(?:ownership|percentage)|capital contributions|ownership interests?|partners and (?:their )?interests/i);return i>=0?t.slice(i,i+4000):t})()
 while((m=ownerRe.exec(section))){const name=clean(m[1]),pct=+m[2];if(!isName(name)||pct<=0||pct>100||/percent|total|interest|capital|units?/i.test(name))continue;const key=name.toLowerCase();if(seen.has(key))continue;seen.add(key);owners.push({name,percentage:pct,evidence:evidence(section,m.index,m[0].length)})}
 if(!owners.length){const list=/(?:members?|partners|shareholders|organizers?)\s*(?:are|is|:)\s*([A-Z][^\n.]{3,200})/i.exec(t);if(list)for(const part of list[1].split(/,|\band\b/)){const name=clean(part.replace(/\(.*?\)/g,''));if(isName(name)&&/^[A-Z][a-z]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(name)&&!seen.has(name.toLowerCase())){seen.add(name.toLowerCase());owners.push({name,percentage:null,evidence:evidence(t,list.index,list[0].length)})}}}
 out.owners=owners.slice(0,20)
 return out}

/* ---------- lease: landlord, contact, dates, rent, CAM ---------- */
function leasePass(t){const out={}
 out.landlord=find(t,/(?:^|\n|between|by)\s*([A-Z][A-Za-z0-9&.,' -]{2,100}?)\s*,?\s*(?:a [^(]{0,80})?\(\s*(?:hereinafter\s+)?(?:referred to as\s+)?(?:the\s+)?"?(?:Landlord|Lessor)"?\s*\)/,1,party)
  ||find(t,/(?:^|\n)\s*(?:landlord|lessor)\s*(?:name)?\s*:\s*([^\n]{2,100})/i,1,clean)
 if(out.landlord&&!isName(out.landlord.value))out.landlord=null
 out.tenant=find(t,/(?:and|,)\s*([A-Z][A-Za-z0-9&.,' -]{2,100}?)\s*,?\s*(?:a [^(]{0,80})?\(\s*(?:hereinafter\s+)?(?:referred to as\s+)?(?:the\s+)?"?(?:Tenant|Lessee)"?\s*\)/,1,party)||find(t,/(?:^|\n)\s*(?:tenant|lessee)\s*(?:name)?\s*:\s*([^\n]{2,100})/i,1,clean)
 const c=contactNear(t,'landlord|lessor|property manager');if(c)out.landlord_contact={value:{name:c.name,email:c.email,phone:c.phone},evidence:c.evidence}
 out.premises=find(t,/(?:premises|property|leased premises)\s*(?:address)?\s*(?:located at|commonly known as|:)\s*([^\n]{6,160})/i,1,x=>clean(x).replace(/\.$/,''))
 out.effective_date=find(t,new RegExp('(?:commencement date|lease commencement|effective date|term (?:shall )?(?:commence|begin)s?(?: on)?|commencing on|beginning on|rent commencement date)[^\\n]{0,40}?'+DATE_RE.source,'i'),1,parseDate)
 out.expiration_date=find(t,new RegExp('(?:expiration date|termination date|expire(?:s)? on|end(?:ing)? on|terminat(?:e|ing) on|through and including)[^\\n]{0,40}?'+DATE_RE.source,'i'),1,parseDate)
 out.term_months=find(t,/(?:lease term|term of (?:this lease|the lease)|initial term|term)\s*(?:shall be|of|is|:)?\s*(?:for\s+)?(?:a period of\s+)?([a-z-]+\s*\(\d{1,3}\)\s*(?:years?|months?)|\d{1,3}\s*(?:-|\s)?(?:years?|months?)|[a-z-]+\s+(?:years?|months?))/i,1,termMonths)
 if(!out.expiration_date&&out.effective_date&&out.term_months)out.expiration_date={value:dayBefore(addMonths(out.effective_date.value,out.term_months.value)),evidence:'Calculated from the commencement date and a '+out.term_months.value+'-month term.',calculated:true}
 const rent=find(t,new RegExp('(?:base rent|minimum (?:annual |monthly )?rent|fixed rent|monthly rent|annual rent)[^\\n$]{0,80}?'+MONEY+'([^\\n]{0,60})','i'),0,x=>x)
 if(rent){const m=new RegExp(MONEY+'([^\\n]{0,60})').exec(rent.value);const amt=money(m[1]),rest=(m[2]+' '+rent.value).toLowerCase();const psf=/per (?:rentable )?square foot|\/\s*sf|psf/.test(rest);out.base_rent={value:{amount:amt,period:psf?'square foot per year':/annual|per year|per annum|yearly/.test(rest)?'year':'month'},evidence:rent.evidence}}
 const cam=find(t,new RegExp('(?:common area maintenance|\\bCAM\\b|operating expenses|additional rent)[^\\n$]{0,100}?'+MONEY+'([^\\n]{0,60})','i'),0,x=>x)
 if(cam){const m=new RegExp(MONEY+'([^\\n]{0,60})').exec(cam.value);const rest=(m[2]+' '+cam.value).toLowerCase();out.cam={value:{amount:money(m[1]),period:/per (?:rentable )?square foot|\/\s*sf|psf/.test(rest)?'square foot per year':/annual|per year|per annum/.test(rest)?'year':'month',basis:/estimate/.test(rest)?'Estimated':''},evidence:cam.evidence}}
 else{const share=find(t,/(?:pro rata share|tenant's share|proportionate share)[^\n]{0,80}?(\d{1,2}(?:\.\d{1,2})?)\s*%/i);if(share)out.cam={value:{amount:null,period:'',basis:share.value+'% pro rata share of common area costs'},evidence:share.evidence}}
 out.security_deposit=find(t,new RegExp('security deposit[^\\n$]{0,60}?'+MONEY,'i'),1,money)
 out.renewal=find(t,/((?:one|two|three|four|\d)\s*(?:\(\d\)\s*)?(?:successive\s+)?(?:options?|renewal options?)[^\n.]{0,80}(?:years?|months?))/i,1,clean)
 return out}

/* ---------- loan: lender, contact, amount, rate, term, payment, schedule ---------- */
function loanPass(t){const out={}
 out.lender=find(t,/([A-Z][A-Za-z0-9&.,' -]{2,100}?(?:Bank|Credit Union|Capital|Financial|Lending|Bancorp|N\.A\.|Funding)[A-Za-z.,' -]{0,30}?)\s*,?\s*(?:a [^(]{0,80})?\(\s*(?:hereinafter\s+)?(?:the\s+)?"?Lender"?\s*\)/,1,party)
  ||find(t,/(?:^|\n)\s*(?:lender|bank|payee)\s*(?:name)?\s*:\s*([^\n]{2,100})/i,1,clean)
  ||find(t,/(?:payable to the order of|promises to pay to)\s+([A-Z][A-Za-z0-9&.,' -]{2,100}?)(?:\s*\(|,|\s+the principal|\s+at)/,1,clean)
 if(out.lender&&!isName(out.lender.value))out.lender=null
 const c=contactNear(t,'lender|loan officer|relationship manager|bank contact|notices to');if(c)out.contact={value:{name:c.name,email:c.email,phone:c.phone},evidence:c.evidence}
 out.loan_number=find(t,/(?:loan (?:number|no\.?|#)|note (?:number|no\.?)|account (?:number|no\.?))\s*:?\s*([A-Z0-9-]{4,30})/i)
 out.amount=find(t,new RegExp('(?:principal (?:sum|amount) of|loan amount|original principal(?: amount)?|face amount|in the amount of|note amount)[^\\n$]{0,80}?'+MONEY,'i'),1,money)
 out.apr=find(t,/(?:interest rate|rate of interest|at a rate|annual rate|fixed rate)[^\n%]{0,80}?(\d{1,2}(?:\.\d{1,4})?)\s*%/i,1,Number)||find(t,/(\d{1,2}(?:\.\d{1,4})?)\s*%\s*per annum/i,1,Number)
 out.term_months=find(t,/(?:term of|loan term|term|over|amortized over|payable over)\s*(?:the loan\s*)?(?:shall be|of|is|:)?\s*([a-z-]+\s*\(\d{1,3}\)\s*(?:years?|months?)|\d{1,3}\s*(?:-|\s)?(?:years?|months?))/i,1,termMonths)
 out.payment=find(t,new RegExp('(?:monthly (?:installments?|payments?) (?:of|in the amount of|equal to)|payments? of principal and interest (?:of|in the amount of)|monthly payment(?: amount)?\\s*:?)[^\\n$]{0,40}?'+MONEY,'i'),1,money)
 out.first_payment_date=find(t,new RegExp('(?:first (?:payment|installment)(?: date)?|payments? (?:shall )?(?:begin|commence|start)(?:ning)?(?: on)?|beginning on)[^\\n]{0,40}?'+DATE_RE.source,'i'),1,parseDate)
 out.maturity_date=find(t,new RegExp('(?:maturity date|matures on|due and payable (?:in full )?on|final payment(?: date)?)[^\\n]{0,40}?'+DATE_RE.source,'i'),1,parseDate)
 out.note_date=find(t,new RegExp('(?:note date|date of note|dated|effective date)[^\\n]{0,20}?'+DATE_RE.source,'i'),1,parseDate)
 if(!out.term_months&&out.first_payment_date&&out.maturity_date){const a=new Date(out.first_payment_date.value),b=new Date(out.maturity_date.value),n=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()+1;if(n>0&&n<=600)out.term_months={value:n,evidence:'Calculated from the first payment and maturity dates.',calculated:true}}
 out.loan_type=find(t,/\b(SBA 7\(a\)|SBA 504|SBA Express|equipment (?:loan|financing)|term loan|line of credit)(?![A-Za-z])/i,1,clean)
 return out}

/* PDFs wrap lines anywhere. Read the text as laid out, then with soft line breaks joined, and keep the
   first value found for each field (owners: the pass that found more). */
const joined=t=>t.replace(/([^\n])\n(?!\n)/g,'$1 ')
function twoPass(pass,raw){const t=norm(raw),a=pass(t),b=pass(joined(t));for(const k of Object.keys(b)){if(k==='owners'){if((b.owners||[]).length>(a.owners||[]).length)a.owners=b.owners;continue}if(!a[k]&&b[k])a[k]=b[k]}
 /* Derived values are recomputed from the merged result. */
 if(pass===leasePass&&a.effective_date&&a.term_months&&(!a.expiration_date||a.expiration_date.calculated))a.expiration_date={value:dayBefore(addMonths(a.effective_date.value,a.term_months.value)),evidence:'Calculated from the commencement date and a '+a.term_months.value+'-month term.',calculated:true}
 return a}
const entity=raw=>twoPass(entityPass,raw),lease=raw=>twoPass(leasePass,raw),loan=raw=>twoPass(loanPass,raw)

/* ---------- schedule: standard amortization, labeled as a calculation ---------- */
function payment(amount,apr,months){if(!(amount>0)||!(months>0))return null;const r=(apr||0)/1200;return r?amount*r/(1-Math.pow(1+r,-months)):amount/months}
function schedule({amount,apr,term_months,payment:pay,first_payment_date}){if(!(amount>0)||!(term_months>0)||!(apr>=0))return null
 const r=apr/1200,pmt=pay>0?pay:payment(amount,apr,term_months),rows=[];let bal=amount,totalInterest=0;const start=first_payment_date||''
 for(let n=1;n<=term_months&&bal>0.005;n++){const interest=Math.round(bal*r*100)/100;let principal=Math.round((pmt-interest)*100)/100;if(n===term_months||principal>bal)principal=Math.round(bal*100)/100;bal=Math.round((bal-principal)*100)/100;totalInterest+=interest;rows.push({n,date:start?addMonths(start,n-1):'',payment:Math.round((principal+interest)*100)/100,principal,interest,balance:Math.max(0,bal)})}
 return {payment:Math.round(pmt*100)/100,rows,total_interest:Math.round(totalInterest*100)/100,payoff_date:rows.at(-1)?.date||'',calculated:!(pay>0)}}
function balanceOn(s,dateIso){if(!s?.rows?.length)return null;let bal=s.rows[0].balance+s.rows[0].principal;for(const r of s.rows){if(r.date&&r.date>dateIso)break;bal=r.balance}return bal}

/* ---------- text from the file the owner chose ---------- */
async function textOf(file){const name=file.name||'';if(/\.(txt|csv|md)$/i.test(name)||/^text\//.test(file.type||''))return (await file.text()).slice(0,400000)
 if(/\.pdf$/i.test(name)||file.type==='application/pdf'){const js=await import('./fran-pdf.mjs');js.GlobalWorkerOptions.workerSrc=new URL('./fran-pdf-worker.mjs',document.baseURI).href
  const pdf=await js.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;let out='';try{for(let n=1;n<=Math.min(pdf.numPages,60);n++){const page=await pdf.getPage(n),c=await page.getTextContent();let lastY=null;for(const it of c.items){const y=it.transform?.[5];if(lastY!==null&&y!==undefined&&Math.abs(y-lastY)>2)out+='\n';else if(out&&!out.endsWith(' ')&&!out.endsWith('\n'))out+=' ';out+=it.str||'';lastY=y??lastY}out+='\n\n';page.cleanup()}}finally{pdf.destroy()}return out.slice(0,400000)}
 return ''}
/* The document decides its own type when it clearly says so; otherwise the step the owner is on does. */
function read(text,name,hint){const k=detect(text,name)||hint||null;if(!k)return {kind:null,fields:{},found:0};const fields=k==='entity'?entity(text):k==='lease'?lease(text):loan(text)
 const found=Object.values(fields).filter(v=>Array.isArray(v)?v.length:v).length;return {kind:k,fields,found}}
const api={detect,entity,lease,loan,schedule,payment,balanceOn,parseDate,addMonths,textOf,read,STATES}
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FranExtract=api
})(typeof window!=='undefined'?window:globalThis);
