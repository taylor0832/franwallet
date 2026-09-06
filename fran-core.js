/* Pure financial workspace rules. Shared by the UI, server and tests. */
(function(root){
'use strict';
const text=(x,n=180)=>String(x??'').trim().slice(0,n);
const num=(x,label,min=0,max=1e12)=>{if(!['number','string'].includes(typeof x)||String(x).trim()===''||x==null||!Number.isFinite(Number(x))||Number(x)<min||Number(x)>max)throw Error(label+' is invalid.');return Number(x)};
const date=(x)=>{const s=text(x,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Error('Use a valid date (YYYY-MM-DD).');return s};
function validate(kind,d){
 const required=(v,label)=>{const s=text(v);if(!s)throw Error(label+' is required.');return s};
 if(kind==='payroll')return {provider:required(d.provider,'Provider'),date:date(d.date),gross:num(d.gross,'Gross pay'),taxes:num(d.taxes,'Employer taxes'),benefits:num(d.benefits,'Employer benefits'),reference:required(d.reference,'Unique run reference'),source:'Owner-imported payroll summary'};
 if(kind==='debt')return {lender:required(d.lender,'Lender'),reference:required(d.reference,'Loan reference'),balance:num(d.balance,'Principal balance'),payment:num(d.payment,'Monthly payment'),apr:num(d.apr,'APR',0,100),as_of:date(d.as_of),maturity:d.maturity?date(d.maturity):null,match:text(d.match,80),source:'Owner-entered lender balance'};
 if(kind==='valuation'){const r={period_end:date(d.period_end),net:num(d.net,'Trailing 12-month net income',-1e12),interest:num(d.interest,'Interest'),tax:num(d.tax,'Income tax'),da:num(d.da,'Depreciation and amortization'),adjustments:num(d.adjustments,'Adjustments',-1e12),notes:required(d.notes,'Source and adjustment notes'),low:num(d.low,'Low multiple',0.1,30),high:num(d.high,'High multiple',0.1,30),cash:num(d.cash,'Excess cash'),basis:required(d.basis,'Multiple source')};if(r.high<r.low)throw Error('High multiple must be at least the low multiple.');return r;}
 if(kind==='service'){if(!['payroll','books','insurance','debt'].includes(d.service))throw Error('Choose a service.');return {service:d.service,note:required(d.note,'Request details'),status:'requested',consent:!!d.consent};}
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
function estimate(d,debts){if(!d)return null;const earnings=d.net+d.interest+d.tax+d.da+d.adjustments;if(earnings<=0)return {earnings,available:false};const debt=debts.reduce((s,r)=>s+Number((r.data||r).balance),0);return {available:true,earnings,debt,low:earnings*d.low,high:earnings*d.high,equityLow:earnings*d.low+d.cash-debt,equityHigh:earnings*d.high+d.cash-debt};}
function reconcile(debts,tx,month){return debts.map(r=>{const d=r.data||r;const term=(d.match||d.lender).toLowerCase().trim();const matches=tx.filter(t=>!t.pending&&t.date?.slice(0,7)===month&&t.amount>0&&term.length>=3&&(String(t.merchant||'')+' '+String(t.name||'')).toLowerCase().includes(term)&&Math.abs(t.amount-d.payment)<=Math.max(1,d.payment*.01));return {id:r.id,lender:d.lender,expected:d.payment,matches,status:matches.length===1?'Possible payment match':matches.length>1?'Multiple matches — review':'No matching payment found'};});}
const api={validate,parseCSV,mapCSV,fields,estimate,reconcile};root.FranCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
