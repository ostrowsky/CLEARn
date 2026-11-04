// Shared legacy JSON transport. Expo uses the typed api.ts transport instead.
window.CLEARnRequest = async function(path, options = {}) {
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),/backup|upload/.test(path)?120000:15000);
 try{
  const response=await fetch(path,{...options,credentials:'include',signal:controller.signal});
  if(!/json/i.test(response.headers.get('content-type')||''))throw new Error('API returned a non-JSON response ('+response.status+').');
  const data=await response.json();
  if(!response.ok)throw new Error(data?.message||data?.error||'API request failed: '+response.status);
  if(!data||typeof data!=='object'||Array.isArray(data)||!Object.keys(data).length)throw new Error('Invalid API response.');
  if(path==='/api/content'&&(!data.meta||!Array.isArray(data.sections)))throw new Error('Invalid content response.');
  return data;
 }finally{clearTimeout(timer);}
};
