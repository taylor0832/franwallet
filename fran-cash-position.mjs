export function cashPosition({opening,receipts,payments,buffer}){
 const numbers=[opening,receipts,payments,buffer];
 if(numbers.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e12))throw new Error('Enter non-negative amounts up to one trillion in the same currency.');
 const cents=n=>Math.round(n*100);
 const closing=cents(opening)+cents(receipts)-cents(payments);
 return {closing:closing/100,headroom:(closing-cents(buffer))/100};
}
if(typeof document!=='undefined'){
 const form=document.getElementById('cash-form');
 const fields=['opening','receipts','payments','buffer'];
 const output=document.getElementById('cash-result');
 const fmt=n=>new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
 form.addEventListener('submit',e=>{e.preventDefault();try{const values=Object.fromEntries(fields.map(k=>{const v=form.elements[k].value.trim();if(v==='')throw Error('Complete every amount before calculating.');return [k,Number(v)];}));const r=cashPosition(values);output.textContent=`Projected closing cash: ${fmt(r.closing)}. ${r.headroom<0?'Shortfall against':'Headroom above'} your chosen buffer: ${fmt(Math.abs(r.headroom))}. Planning only; review payment dates and source records.`;}catch(error){output.textContent=error.message;}});
 document.getElementById('cash-example').addEventListener('click',()=>{[40000,20000,35000,10000].forEach((v,i)=>{form.elements[fields[i]].value=v;});form.requestSubmit();});
 form.addEventListener('input',()=>{output.textContent='Figures changed. Calculate again to update the result.';});
}
