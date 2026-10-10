/* Invite preview: the owner sees the exact email their partner will get, then sends it from Fran, copies a message
   for a text, or opens their own email app. The preview comes from the same server template as the real send.
   When Fran can't send (email not configured, or the service is unavailable), Send is switched off and the owner is
   pointed to Copy link or their own email app; the invite itself is already saved. */
(()=>{'use strict'
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const metric=(n,p)=>{try{window.posthog?.capture(n,p)}catch(_){}}
const NAME_KEY='fran_invite_from'
const NOTE={accounting:'Hi! Could you connect our QuickBooks so I can see the monthly numbers in one place?',payroll:'Hi! Could you add our payroll reports so I can see labor against sales?',insurance:'Hi! Could you add our current policies and certificates?',entity:'Hi! Could you add our formation documents and EIN letter?'}
function remembered(){try{return localStorage.getItem(NAME_KEY)||''}catch(_){return ''}}
function open({call,grantId,url,email,scope,location,who}){return new Promise(resolve=>{
 let d=document.getElementById('fran-invite');if(d)d.remove();d=document.createElement('dialog');d.id='fran-invite';d.setAttribute('aria-labelledby','fi-title')
 const meName=(typeof ME!=='undefined'&&ME?.name)||remembered()
 d.innerHTML='<div class="fi-wrap"><header class="fi-head"><div><p class="fi-eyebrow">Invite your '+E(who||'partner')+'</p><h2 id="fi-title">Send the invitation</h2></div><button type="button" class="fi-x" aria-label="Close" data-close>×</button></header>'+
 '<div class="fi-body"><form class="fi-form" novalidate><div class="fi-row"><span class="fi-label">To</span><span class="fi-to">'+E(email)+'</span></div>'+
 '<label class="fi-label" for="fi-from">Your name</label><input id="fi-from" maxlength="60" placeholder="For example, Taylor Byington" value="'+E(meName)+'" autocomplete="name">'+
 '<label class="fi-label" for="fi-note">Add a note <small>optional</small></label><textarea id="fi-note" rows="4" maxlength="500" placeholder="'+E(NOTE[scope]||NOTE.accounting)+'"></textarea>'+
 '<p class="fi-fine">The email comes from Fran Wallet on your behalf. Replies go to you. The link works only for '+E(email)+', for '+E(location)+' only, for 30 days.</p>'+
 '<div class="fi-actions"><button type="submit" class="fi-send">Send from Fran</button><button type="button" class="fi-alt" data-copy>Copy message for a text</button><button type="button" class="fi-alt" data-copy-link>Copy link</button><button type="button" class="fi-alt" data-mail>Open in my email app</button></div><p class="fi-status" role="status" aria-live="polite"></p></form>'+
 '<section class="fi-preview" aria-label="Email preview"><div class="fi-meta"><span>Subject</span><strong data-subject>Loading preview…</strong></div><iframe title="Email preview" sandbox="" data-frame></iframe></section></div></div>'
 document.body.append(d)
 const from=d.querySelector('#fi-from'),note=d.querySelector('#fi-note'),st=d.querySelector('.fi-status'),frame=d.querySelector('[data-frame]'),subj=d.querySelector('[data-subject]')
 let mail=null,used='none',timer=null,seq=0,canSend=true
 const status=(t,k='')=>{st.textContent=t;st.className='fi-status'+(k?' '+k:'')}
 const sendBtn=d.querySelector('.fi-send')
 /* Fran can't send: keep the invite, switch Send off and point to the two ways that always work. */
 function noSend(message){canSend=false;sendBtn.disabled=true;sendBtn.textContent='Sending from Fran is unavailable';status((message||'Fran can’t send email right now.')+' Use Copy link or Open in my email app; your invite is saved.','err')}
 const unavailable=e=>[400,403,404,501,502,503].includes(e?.status)
 async function preview(){const n=++seq;try{const m=await call('preview',{id:grantId,from_name:from.value,note:note.value});if(n!==seq)return;mail=m;subj.textContent=m.subject;frame.srcdoc=m.html}catch(e){if(n!==seq)return;subj.textContent='Invitation to Fran Wallet';frame.srcdoc='<pre style="font:14px/1.5 sans-serif;white-space:pre-wrap;padding:16px;color:#173b32">'+E(text())+'</pre>';if(unavailable(e))noSend('Fran’s email preview isn’t available right now.');else status('Preview didn’t load ('+e.message+'). This is the message you can copy.','err')}}
 const later=()=>{clearTimeout(timer);timer=setTimeout(preview,350)}
 from.oninput=later;note.oninput=later;preview()
 const text=()=>(from.value.trim()?'Hi, it’s '+from.value.trim()+'. ':'Hi! ')+(note.value.trim()?note.value.trim()+' ':'')+'I’ve invited you to help with '+location+' in Fran Wallet. Sign in with '+email+' here: '+url
 const finish=()=>{try{if(from.value.trim())localStorage.setItem(NAME_KEY,from.value.trim())}catch(_){}d.close()}
 d.querySelector('form').onsubmit=async e=>{e.preventDefault();if(!canSend)return;const b=sendBtn;b.disabled=true;status('Sending…');try{const r=await call('send',{id:grantId,from_name:from.value,note:note.value});used='sent';metric('invite_sent',{scope,repeat:!!r?.already_sent});status(r?.already_sent?'Already sent to '+email+' a few minutes ago.':'✓ Sent to '+email+'.','ok');b.textContent='Sent';setTimeout(finish,900)}catch(err){if(unavailable(err)||err?.status===429){noSend(err.message);d.querySelector('[data-copy-link]').focus()}else{status((err.message||'The email couldn’t be sent.')+' You can copy the link instead.','err');b.disabled=false}}}
 d.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(text());used=used==='sent'?used:'copied';metric('invite_copied',{scope});status('Copied. Paste it into a text or chat.','ok')}catch(_){status('Copy didn’t work here. The link is: '+url)}}
 d.querySelector('[data-copy-link]').onclick=async()=>{try{await navigator.clipboard.writeText(url);used=used==='sent'?used:'copied';metric('invite_link_copied',{scope});status('Link copied. Send it to '+email+' by text or email.','ok')}catch(_){status('Copy didn’t work here. The link is: '+url)}}
 d.querySelector('[data-mail]').onclick=()=>{used=used==='sent'?used:'mailto';metric('invite_mailto',{scope});const s=mail?.subject||'Invitation to Fran Wallet';window.location.href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(s)+'&body='+encodeURIComponent(text());status('Opening your email app…','ok')}
 d.querySelector('[data-close]').onclick=finish
 d.addEventListener('click',e=>{if(e.target===d)finish()})
 d.addEventListener('close',()=>{d.remove();resolve(used)})
 d.showModal();requestAnimationFrame(()=>(from.value?note:from).focus())})}
window.FRAN_INVITE={open}
})()
