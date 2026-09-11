/* Pure financial workspace rules. Shared by the UI, server and tests. */
(function(root){
'use strict';
const text=(x,n=180)=>String(x??'').trim().slice(0,n);
const num=(x,label,min=0,max=1e12)=>{if(!['number','string'].includes(typeof x)||String(x).trim()===''||x==null||!Number.isFinite(Number(x))||Number(x)<min||Number(x)>max)throw Error(label+' is invalid.');return Number(x)};
const date=(x)=>{const s=text(x,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Error('Use a valid date (YYYY-MM-DD).');return s};
function validate(kind,d){
 const required=(v,label)=>{const s=text(v);if(!s)throw Error(label+' is required.');return s};
 if(kind==='sales'){
  const r={provider:required(d.provider,'POS provider'),merchant:required(d.merchant,'POS store reference'),timezone:required(d.timezone,'Store timezone'),date:date(d.date),gross:num(d.gross,'Gross sales'),discounts:num(d.discounts,'Discounts'),refunds:num(d.refunds,'Refunds'),net:num(d.net,'Net sales',-1e12),tax:num(d.tax,'Sales tax'),tips:num(d.tips,'Tips'),orders:num(d.orders,'Completed orders'),currency:'USD',complete:d.complete===true,source:'Owner-imported daily POS summary'};
  let parts;try{parts=new Intl.DateTimeFormat('en-US',{timeZone:r.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());}catch{throw Error('Use a valid store timezone.');}
  const today=['year','month','day'].map(k=>parts.find(x=>x.type===k).value).join('-');if(r.date>=today)throw Error('Import closed business days before today.');
  if(!r.complete)throw Error('Confirm these are complete daily summaries.');if(!Number.isInteger(r.orders))throw Error('Completed orders must be a whole number.');if(d.currency&&d.currency!=='USD')throw Error('Sales imports currently support USD only.');
  if(Math.abs(r.gross-r.discounts-r.refunds-r.net)>.021)throw Error('Net sales must equal gross sales less discounts and refunds; exclude tax and tips.');return r;
 }
 if(kind==='payroll')return {provider:required(d.provider,'Provider'),date:date(d.date),gross:num(d.gross,'Gross pay'),taxes:num(d.taxes,'Employer taxes'),benefits:num(d.benefits,'Employer benefits'),reference:required(d.reference,'Unique run reference'),source:'Owner-imported payroll summary'};
 if(kind==='debt')return {lender:required(d.lender,'Lender'),reference:required(d.reference,'Loan reference'),balance:num(d.balance,'Principal balance'),payment:num(d.payment,'Monthly payment'),apr:num(d.apr,'APR',0,100),as_of:date(d.as_of),maturity:d.maturity?date(d.maturity):null,match:text(d.match,80),source:'Owner-entered lender balance'};
 if(kind==='valuation'){const r={period_end:date(d.period_end),net:num(d.net,'Trailing 12-month net income',-1e12),interest:num(d.interest,'Interest'),tax:num(d.tax,'Income tax'),da:num(d.da,'Depreciation and amortization'),adjustments:num(d.adjustments,'Adjustments',-1e12),notes:required(d.notes,'Source and adjustment notes'),low:num(d.low,'Low multiple',0.1,30),high:num(d.high,'High multiple',0.1,30),cash:num(d.cash,'Excess cash'),basis:required(d.basis,'Multiple source')};if(r.high<r.low)throw Error('High multiple must be at least the low multiple.');
 r.method=d.method||'ebitda';if(!['ebitda','revenue'].includes(r.method))throw Error('Choose EBITDA or revenue.');
 r.revenue=num(d.revenue??0,'Revenue');r.multiple=num(d.multiple??r.low,'Selected multiple',0.1,30);
 r.period_months=num(d.period_months??12,'Months covered',1,12);if(!Number.isInteger(r.period_months))throw Error('Use whole reporting months.');
 r.period_basis=d.period_basis||'legacy';if(!['trailing12','partial','annualized','legacy'].includes(r.period_basis))throw Error('Choose a reporting basis.');
 if(r.period_basis==='trailing12'&&r.period_months!==12)throw Error('A trailing year needs 12 months.');
 r.period_start=d.period_start?date(d.period_start):null;if(r.period_start&&r.period_start>r.period_end)throw Error('Period start must precede its end.');
 return r;}
 if(kind==='service'){if(!['payroll','books','insurance','debt','sales','spend','entity','tax','legal','support'].includes(d.service))throw Error('Choose a service.');return {service:d.service,note:required(d.note,'Request details'),status:'requested',consent:!!d.consent};}
 throw Error('Unsupported record type.');
}
function parseCSV(input){
 if(input.length>2e6)throw Error('CSV files must be smaller than 2 MB.');
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw Error('Unclosed quote in CSV.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length<2)throw Error('Include a header row and at least one data row.');
 if(rows.length>1001)throw Error('Import at most 1,000 rows at a time.');
 const headers=rows.shift().map((x,i)=>x.replace(/^\uFEFF/,'').trim()||'Column '+(i+1));
 if(new Set(headers).size!==headers.length)throw Error('Column headings must be unique.');
 if(rows.some(r=>r.length!==headers.length))throw Error('Every row must have the same number of columns as the header.');
 return {headers,rows};
}
const fields={payroll:['provider','reference','date','gross','taxes','benefits'],debt:['lender','reference','balance','payment','apr','as_of','maturity','match']};
function mapCSV(parsed,mapping,kind){return parsed.rows.map((row,i)=>{const d={};for(const f of fields[kind]){const ix=Number(mapping[f]);d[f]=mapping[f]===''||mapping[f]==null?'':row[ix];if(['gross','taxes','benefits','balance','payment','apr'].includes(f))d[f]=String(d[f]).replace(/[$,%\s]/g,'').replace(/^\((.*)\)$/,'-$1');}try{return validate(kind,d)}catch(e){throw Error('Row '+(i+2)+': '+e.message)}});}
function estimate(d,debts){
 if(!d)return null;
 const earnings=Number(d.net)+Number(d.interest)+Number(d.tax)+Number(d.da)+Number(d.adjustments),method=d.method||'ebitda';
 const factor=d.period_basis==='annualized'?12/Number(d.period_months||12):1;
 const metric=(method==='revenue'?Number(d.revenue):earnings)*factor;
 if(!Number.isFinite(metric)||metric<=0)return {earnings,method,metric,available:false};
 const debt=debts.reduce((s,r)=>s+Number((r.data||r).balance),0),selected=metric*Number(d.multiple??d.low);
 return {available:true,method,metric,earnings,debt,selected,equity:selected+Number(d.cash)-debt,low:metric*d.low,high:metric*d.high,equityLow:metric*d.low+Number(d.cash)-debt,equityHigh:metric*d.high+Number(d.cash)-debt};
}
// Only full calendar-month columns; never silently annualize a year-to-date report.
function valuationFromBooks(books,now=new Date()){
 if(books.length!==1)return null;
 const book=books[0],m=book.snapshot?.monthly;if(!Array.isArray(m?.months))return null;
 const names=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 const cutoff=now.getUTCFullYear()*12+now.getUTCMonth();
 const columns=m.months.map((label,i)=>{const hit=/^([A-Za-z]+) (\d{4})$/.exec(label);if(!hit)return null;const month=names.indexOf(hit[1].slice(0,3).toLowerCase());return month<0?null:{i,key:Number(hit[2])*12+month};}).filter(x=>x&&x.key<cutoff).sort((a,b)=>a.key-b.key).slice(-12);
 if(!columns.length||columns.some((c,i)=>i&&c.key!==columns[i-1].key+1))return null;
 const sum=values=>{if(!Array.isArray(values)||columns.some(c=>values[c.i]==null||!Number.isFinite(Number(values[c.i]))))return null;return Math.round(columns.reduce((n,c)=>n+Number(values[c.i]),0)*100)/100;};
 const revenue=sum(m.income),net=sum(m.net_income);if(revenue===null||net===null)return null;
 const detail=book.snapshot?.pl_detail;const aligned=JSON.stringify(detail?.months)===JSON.stringify(m.months);
 const accounts=aligned?(detail.rows||[]).filter(r=>r.kind==='account'):[];
 const expense=re=>Math.round(accounts.filter(r=>re.test(r.name)).reduce((n,r)=>n+(sum(r.values)||0),0)*100)/100;
 const start=columns[0].key,end=columns.at(-1).key;
 return {revenue,net,interest:expense(/\binterest\b/i),tax:expense(/\bincome tax(?:es)?\b/i),da:expense(/depreciation|amortization/i),adjustments:0,cash:0,
 period_start:new Date(Date.UTC(Math.floor(start/12),start%12,1)).toISOString().slice(0,10),period_end:new Date(Date.UTC(Math.floor(end/12),end%12+1,0)).toISOString().slice(0,10),period_months:columns.length,period_basis:columns.length===12?'trailing12':'partial',
 notes:('QuickBooks: '+(book.company||'connected company')+'. Full calendar months; expense-name matches for interest, income tax and D&A need review. No owner add-backs.').slice(0,180)};
}
function reconcile(debts,tx,month){return debts.map(r=>{const d=r.data||r;const term=(d.match||d.lender).toLowerCase().trim();const matches=tx.filter(t=>!t.pending&&t.date?.slice(0,7)===month&&t.amount>0&&term.length>=3&&(String(t.merchant||'')+' '+String(t.name||'')).toLowerCase().includes(term)&&Math.abs(t.amount-d.payment)<=Math.max(1,d.payment*.01));return {id:r.id,lender:d.lender,expected:d.payment,matches,status:matches.length===1?'Possible payment match':matches.length>1?'Multiple matches — review':'No matching payment found'};});}
const api={validate,parseCSV,mapCSV,fields,estimate,reconcile,valuationFromBooks};root.FranCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
