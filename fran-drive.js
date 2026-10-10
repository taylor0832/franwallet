/* Google Drive for Set up with Fran: the owner picks files (or a folder) in Google's own picker, and the browser
   downloads private copies with a short-lived token limited to drive.file (only what they picked). The files then go
   through the same reading, sorting and saving as dropped files. Nothing else in their Drive is visible to Fran. */
(()=>{'use strict'
const API='https://www.googleapis.com/drive/v3/files/'
const EXPORT={'application/vnd.google-apps.document':['application/pdf','.pdf'],'application/vnd.google-apps.presentation':['application/pdf','.pdf'],'application/vnd.google-apps.spreadsheet':['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xlsx']}
const FOLDER='application/vnd.google-apps.folder',MAX=25*1024*1024
function script(src){return new Promise((ok,no)=>{if(document.querySelector('script[src="'+src+'"]'))return ok();const s=document.createElement('script');s.src=src;s.async=true;s.onload=ok;s.onerror=()=>no(Error('Google Drive couldn’t load. Check your connection and try again.'));document.head.append(s)})}
let ready=null,token=null,tokenAt=0
function enabled(c){return !!(c&&c.client_id&&c.api_key&&c.app_id)}
/* Load Google's scripts ahead of the click so the sign-in window isn't blocked. */
function preload(){return ready||(ready=Promise.all([script('https://accounts.google.com/gsi/client'),script('https://apis.google.com/js/api.js')]).then(()=>new Promise((ok,no)=>gapi.load('picker',{callback:ok,onerror:()=>no(Error('Google’s file picker couldn’t load.'))}))).catch(e=>{ready=null;throw e}))}
function authorize(c){if(token&&Date.now()-tokenAt<50*60000)return Promise.resolve(token)
 return new Promise((ok,no)=>google.accounts.oauth2.initTokenClient({client_id:c.client_id,scope:'https://www.googleapis.com/auth/drive.file',callback:r=>{if(r.error)return no(Error('Google sign-in wasn’t completed.'));token=r.access_token;tokenAt=Date.now();ok(token)},error_callback:()=>no(Error('The Google sign-in window was closed.'))}).requestAccessToken())}
function picker(c,t){return new Promise(ok=>{const docs=new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true)
 new google.picker.PickerBuilder().addView(docs).enableFeature(google.picker.Feature.MULTISELECT_ENABLED).setOAuthToken(t).setDeveloperKey(c.api_key).setAppId(c.app_id).setOrigin(location.origin).setTitle('Choose documents for your Wallet')
  .setCallback(d=>{if(d.action===google.picker.Action.PICKED)ok(d.docs||[]);if(d.action===google.picker.Action.CANCEL)ok(null)}).build().setVisible(true)})}
async function get(url,t){const r=await fetch(url,{headers:{Authorization:'Bearer '+t}});if(!r.ok)throw Error(r.status===403?'Google didn’t allow access to this file.':'Google couldn’t open this file.');return r}
async function children(id,t){const q=encodeURIComponent("'"+id+"' in parents and trashed=false"),files=[],seen=new Set();let cursor='';
 do{const r=await get('https://www.googleapis.com/drive/v3/files?q='+q+'&pageSize=100&fields=nextPageToken,files(id,name,mimeType,size)&supportsAllDrives=true&includeItemsFromAllDrives=true'+(cursor?'&pageToken='+encodeURIComponent(cursor):''),t),page=await r.json();files.push(...(page.files||[]));cursor=page.nextPageToken||'';if(cursor&&seen.has(cursor))throw Error('Google repeated a folder page. Retry the import.');if(cursor)seen.add(cursor);}while(cursor);return files}

async function download(f,t){const ex=EXPORT[f.mimeType];if(f.mimeType?.startsWith('application/vnd.google-apps.')&&!ex)throw Error('This Google file type can’t be copied. Download it as a PDF instead.')
 if(!ex&&Number(f.size||f.sizeBytes||0)>MAX)throw Error('Over 25 MB.')
 const r=await get(ex?API+f.id+'/export?mimeType='+encodeURIComponent(ex[0]):API+f.id+'?alt=media&supportsAllDrives=true',t),blob=await r.blob();if(blob.size>MAX)throw Error('Over 25 MB.')
 let name=String(f.name||'Drive file').slice(0,160);if(ex&&!name.toLowerCase().endsWith(ex[1]))name+=ex[1]
 return new File([blob],name,{type:ex?ex[0]:(f.mimeType||blob.type||'application/octet-stream'),lastModified:Date.now()})}
/* Returns {files, skipped:[{name,reason}], folderEmpty} or null when canceled. */
async function pick(c,{onStatus=()=>{}}={}){if(!enabled(c))throw Error('Google Drive isn’t switched on yet.')
 await preload();const t=await authorize(c),picked=await picker(c,t);if(!picked)return null
 let items=[],folderEmpty=false;const files=[],skipped=[],seen=new Set()
 for(const d of picked){if(d.mimeType===FOLDER){onStatus('Opening '+d.name+'…');try{const kids=await children(d.id,t),direct=kids.filter(k=>k.mimeType!==FOLDER);if(!kids.length)folderEmpty=true;items.push(...direct);for(const sub of kids.filter(k=>k.mimeType===FOLDER))skipped.push({name:sub.name,reason:'Subfolder not imported. Select it separately.'});}catch(e){skipped.push({name:d.name,reason:e.message});}}else items.push({id:d.id,name:d.name,mimeType:d.mimeType,size:d.sizeBytes})}
 items=items.filter(f=>{if(seen.has(f.id))return false;seen.add(f.id);return true;})
 for(let i=0;i<items.length;i++){onStatus('Copying '+(i+1)+' of '+items.length+' from Google Drive…');try{files.push(await download(items[i],t))}catch(e){skipped.push({name:items[i].name,reason:e.message})}}
 return {files,skipped,folderEmpty}}
window.FRAN_DRIVE={enabled,preload,pick}
})()
