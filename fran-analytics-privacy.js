/* No auth/callback URLs or attribution query values in product analytics. */
(function(root){'use strict';
 const privateKey=/(?:url|referrer|utm_|gclid|fbclid|msclkid|(?:^|[_$])(?:hash|search|query)$)/i;
 function clean(value){
  if(Array.isArray(value))return value.map(clean);
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,item] of Object.entries(value)){
   if(privateKey.test(key))continue;
   result[key]=/pathname$/i.test(key)&&typeof item==='string'?item.split(/[?#]/)[0]:clean(item);
  }
  return result;
 }
 function beforeSend(event){if(!event)return event;return {...event,properties:clean(event.properties||{})};}
 root.FranAnalyticsPrivacy={beforeSend};
 if(typeof module==='object'&&module.exports)module.exports=root.FranAnalyticsPrivacy;
})(typeof window!=='undefined'?window:globalThis);
