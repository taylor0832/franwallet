/* Uses the same Supabase project and browser session as wallet.html. Public anon key only. */
const client = supabase.createClient('https://nlshvthmcnwuygaeague.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sc2h2dGhtY253dXlnYWVhZ3VlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjM4NTksImV4cCI6MjA5NDY5OTg1OX0.fOTXhlZWtl8MOtC7kJnc8JI8TEvBm2J518mDXKkPGyA');
const id = new URLSearchParams(location.search).get('authorization_id');
const el = (id) => document.getElementById(id);
let approvedRedirect = null;
function status(message){el('status').textContent=message;}
async function refresh(){
 const {data:{user}}=await client.auth.getUser();
 el('signin').hidden=!!user;
 if(!user){status('Use the email associated with your Fran Wallet.');return;}
 el('verify').hidden=true;
 if(!id){
  el('intro').textContent='Manage the applications connected to your Fran account.';
  const {data,error}=await client.auth.oauth.listGrants();if(error)throw error;
  el('connections').hidden=false;el('grants').replaceChildren();
  for(const grant of data||[]){const row=document.createElement('p');row.textContent=grant.client.name;const button=document.createElement('button');button.className='secondary';button.textContent='Revoke';button.onclick=async()=>{const {error}=await client.auth.oauth.revokeGrant({clientId:grant.client.id});if(error)status(error.message);else{status('Connection revoked.');await refresh();}};row.append(button);el('grants').append(row);}
  if(!el('grants').children.length)el('grants').textContent='No applications connected.';return;
 }
 if(!/^[a-zA-Z0-9_-]{8,200}$/.test(id))throw Error('Invalid connection request.');
 const {data,error}=await client.auth.oauth.getAuthorizationDetails(id);if(error)throw error;
 if(data.redirect_url){location.assign(data.redirect_url);return;}
 approvedRedirect=data.redirect_uri;
 el('client').textContent=data.client.name||'Application requesting access';
 el('identity').textContent='Connected as '+user.email;
 el('scopes').textContent='Requested account scopes: '+data.scope;
 el('consent').hidden=false;status('Review the application name before approving.');
}
el('signin').onsubmit=async(event)=>{event.preventDefault();const button=event.submitter,email=el('email').value.trim(),password=el('password').value,mode=password?'password':'code';if(button)button.disabled=true;try{if(mode==='password'){const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;await refresh();}else{const {error}=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false}});if(error)throw error;el('verify').hidden=false;status('Check your email for your Fran sign-in code.');}}catch(error){status(error.message);}finally{if(button)button.disabled=false;}};
el('verify').onsubmit=async(event)=>{event.preventDefault();const {error}=await client.auth.verifyOtp({email:el('email').value.trim(),token:el('code').value.trim(),type:'email'});if(error)status(error.message);else refresh().catch(error=>status(error.message));};
for(const action of ['approve','deny'])el(action).onclick=async()=>{el('approve').disabled=true;el('deny').disabled=true;try{const method=action==='approve'?'approveAuthorization':'denyAuthorization';const {data,error}=await client.auth.oauth[method](id,{skipBrowserRedirect:true});if(error)throw error;const next=new URL(data.redirect_url),expected=new URL(approvedRedirect);if(next.origin!==expected.origin||next.pathname!==expected.pathname)throw Error('Unexpected callback. Restart the connection.');location.assign(next.href);}catch(error){status(error.message);el('approve').disabled=false;el('deny').disabled=false;}};
refresh().catch(error=>status(error.message));
