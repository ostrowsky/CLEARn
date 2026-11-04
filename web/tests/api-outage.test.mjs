import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const platform=path.join(root,'platform');
const require=createRequire(path.join(platform,'package.json'));
const ts=require('typescript');
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const inventory=JSON.parse(await fs.readFile(path.join(root,'web/tests/api-call-inventory.json'),'utf8'));
const strict=process.argv.includes('--probe-malformed');
const source=await fs.readFile(path.join(platform,'apps/client/src/lib/api.ts'),'utf8');
const ast=ts.createSourceFile('api.ts',source,ts.ScriptTarget.Latest,true);
let names=[];
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='apiClient')names=node.initializer.properties.map(p=>p.name.getText(ast));ts.forEachChild(node,visit);}visit(ast);
assert.deepEqual(names.sort(),inventory.methods.map(m=>m.name).sort(),'Every new API method must have an explicit outage policy/test');
async function files(dir){const list=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())list.push(...await files(full));else if(/\.[cm]?[jt]sx?$/.test(entry.name))list.push(full);}return list;}
async function boundaries(dirs){const all=(await Promise.all(dirs.map(d=>files(path.join(root,d))))).flat();const found=[];for(const f of all){if(/\bfetch\s*\(/.test(await fs.readFile(f,'utf8')))found.push(path.relative(root,f).replaceAll('\\','/'));}return found.sort();}
assert.deepEqual(await boundaries(['platform/apps/client/src','platform/apps/client/app']),inventory.clientFetchBoundaries.slice().sort(),'New direct client fetch bypass needs review/tests');
assert.deepEqual(await boundaries(['platform/apps/api/src']),inventory.serverFetchBoundaries.slice().sort(),'New server network boundary needs provider/timeout review');
assert.deepEqual(await boundaries(['web/static']),inventory.legacyFetchBoundaries.slice().sort(),'New legacy fetch boundary needs review');
let routes=[];
for(const f of await files(path.join(platform,'apps/api/src/routes'))){const text=await fs.readFile(f,'utf8');routes.push(...Array.from(text.matchAll(/app\.(get|post|put|delete|patch)\('([^']+)'/g),m=>m[1].toUpperCase()+' '+m[2]));}
for(const item of inventory.methods.filter(m=>m.endpoint))assert.ok(routes.includes(item.method+' '+item.endpoint),'Missing backend route '+item.endpoint);
const temp=await fs.mkdtemp(path.join(platform,'.tmp-api-outage-'));
const saved={fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,debug:console.debug};
const gaps=[];const observations=[];let count=0;
try{
 const outfile=path.join(temp,'api.mjs');
 await build({entryPoints:[path.join(platform,'apps/client/src/lib/api.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',tsconfig:path.join(platform,'tsconfig.base.json'),plugins:[{name:'test-config',setup(b){b.onResolve({filter:/^@clearn\/domain$/},()=>({path:path.join(platform,'packages/domain/src/index.ts')}));b.onResolve({filter:/^\.\/config$/},args=>args.importer.replaceAll('\\','/').endsWith('/lib/api.ts')?{path:'config',namespace:'test'}:undefined);b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:"export const apiBaseUrl='https://api.clearn.test';",loader:'js'}));}}]});
 const {apiClient}=await import(pathToFileURL(outfile).href);
 const clarify={userQuestion:'Sorry, the bug is only reproducible on what?',expectedQuestion:'Sorry, the bug is only reproducible on what?'};
 const after={question:'You mentioned release timing. Could you explain that in a bit more detail?',detail:'release timing',contextPhrase:'You mentioned',followUpPhrase:'Could you explain that in a bit more detail?'};
 const formation={userQuestion:'What will they review?',sentence:'Stakeholders will review return on investment at the end of the year.',answer:'return on investment',whWord:'What',expectedQuestion:'What will they review?'};
 console.debug=()=>{};
 for(const mode of (strict?['html200','empty-json200']:['503-html','network','abort','400','401','429','500'])){
  let answering,coach;let calls=[],timers=[];
  globalThis.setTimeout=(fn,ms,...args)=>{timers.push(ms);return saved.setTimeout(fn,0,...args);};
  globalThis.fetch=async(url,init={})=>{
   const pathname=new URL(url).pathname;
   if(pathname==='/api/debug/log'){
    if(mode==='network')throw new TypeError('Failed to fetch');
    return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});
   }
   calls.push({path:pathname,method:init.method||'GET',credentials:init.credentials,signal:init.signal});
   if(mode==='network')throw new TypeError('Failed to fetch');
   if(mode==='abort')return new Promise((resolve,reject)=>{const abort=()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}));if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});});
   const status=mode==='html200'||mode==='empty-json200'?200:mode==='503-html'?503:Number(mode);
   return new Response(mode==='html200'||mode==='503-html'?'<html>Service Suspended / SPA</html>':mode==='empty-json200'?'{}':JSON.stringify({message:'Synthetic upstream error '+mode}),{status,headers:{'Content-Type':mode.includes('html')?'text/html':'application/json'}});
  };
  const args={logDebug:['audit','probe'],getDebugLogs:[],getContent:[],getAdminContent:[],getAdminAuthStatus:[],setupAdminAuth:[{}],loginAdmin:[{}],resetAdminPassword:[{}],logoutAdmin:[],saveAdminContent:[{meta:{},sections:[]}],uploadAdminMedia:['test.wav','AAAA'],deleteAdminMedia:['/uploads/test.wav'],getVideoTranscript:['https://www.youtube.com/watch?v=fixture'],getAdminBackupExportUrl:[],restoreAdminBackup:['test.zip','AAAA'],getAdminMediaBackupExportUrl:[],restoreAdminMediaBackup:['test.zip','AAAA'],generateClarify:['test',0],checkClarify:[clarify],askAfter:['the release',0],checkAskAfter:[after],generateQuestionFormation:['the release',0],checkQuestionFormation:[formation],startAnswering:['the release','mixed'],respondAnswering:[],startCoachChat:['the release','clarity','meeting'],continueCoachChat:[],speechToText:['AAAA','audio/wav'],textToSpeech:['test']};
  for(const method of inventory.methods){
   const before=calls.length,previousTimers=timers.length;
   if(method.name==='respondAnswering')args.respondAnswering=[answering?.sessionId||'server-session','neutral-clear','The next release will start next week.','text'];
   if(method.name==='continueCoachChat')args.continueCoachChat=[coach?.sessionId||'server-session','The release will start next week.'];
   let value,error;
   try{value=await Promise.race([Promise.resolve(apiClient[method.name](...args[method.name])),new Promise((_,reject)=>{const t=saved.setTimeout(()=>reject(Error('Audit operation hung')),2000);t.unref?.();})]);}catch(e){error=e;}
   count++;
   if(method.name==='startAnswering')answering=value;
   if(method.name==='startCoachChat')coach=value;
   if(method.policy==='reject'||(method.name!=='getContent'&&['fallback','session'].includes(method.policy)&&['400','401'].includes(mode))){
    if(strict&&!error)gaps.push({mode,method:method.name,gap:'Invalid successful response accepted instead of rejected',valueType:typeof value});
    else assert.ok(error instanceof Error&&error.message,method.name+' must reject during '+mode);
   }else{
    assert.equal(error,undefined,method.name+' should preserve its '+method.policy+' policy in '+mode);
    let valid=true;
    if(method.name==='getContent')valid=Array.isArray(value?.sections)&&value.sections.length>0;
    if(method.name==='getVideoTranscript')valid=value?.available===false&&value?.text==='';
    if(method.name==='askAfter')valid=value?.generatorMode==='client-fallback'&&Array.isArray(value?.speechLines);
    if(method.name==='generateQuestionFormation')valid=Array.isArray(value?.blanks)&&value.blanks.length>0;
    if(method.name==='startAnswering')valid=Boolean(value?.currentTurn&&value.sessionId);
    if(method.name==='respondAnswering')valid=Array.isArray(value?.turns)&&value.turns.length===1;
    if(method.name==='startCoachChat')valid=Array.isArray(value?.messages)&&value.messages.length===1;
    if(method.name==='continueCoachChat')valid=Array.isArray(value?.messages)&&value.messages.some(m=>m.role==='user');
    if(method.policy==='local')valid=value?.accepted===true;
    if(method.policy==='url')valid=value==='https://api.clearn.test'+method.endpoint;
    if(strict&&!valid)gaps.push({mode,method:method.name,gap:'Invalid successful response bypassed usable fallback'});
    else assert.ok(valid,method.name+' fallback/local/URL result invalid under '+mode);
   }
   if(['local','url','best-effort'].includes(method.policy)||(method.policy==='session'&&!['400','401'].includes(mode)))assert.equal(calls.length,before);
   else{assert.equal(calls.length,before+1);assert.equal(calls.at(-1).path,method.endpoint);assert.equal(calls.at(-1).method,method.method);assert.equal(calls.at(-1).credentials,'include');assert.ok(calls.at(-1).signal);}
   if(mode==='abort'&&calls.length>before)observations.push({method:method.name,configuredTimeoutMs:timers[previousTimers]});
  }
 }
 if(process.argv.includes('--probe-sessions')){
  for(const kind of ['answering','coach']){
   globalThis.fetch=async()=>new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});
   const seed=kind==='answering'?await apiClient.startAnswering('Project Zephyr','mixed'):await apiClient.startCoachChat('Project Zephyr','Stay focused','meeting');
   const remote={...seed,sessionId:'server-only-'+kind};
   globalThis.fetch=async()=>new Response(JSON.stringify(remote),{status:200,headers:{'Content-Type':'application/json'}});
   const online=kind==='answering'?await apiClient.startAnswering('Project Zephyr','mixed'):await apiClient.startCoachChat('Project Zephyr','Stay focused','meeting');
   globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};
   try{
    const continued=kind==='answering'?await apiClient.respondAnswering(online.sessionId,'neutral-clear','Our release starts next week.','text'):await apiClient.continueCoachChat(online.sessionId,'Our release starts next week.');
    if(continued.sessionId!==online.sessionId||continued.context!==online.context)gaps.push({mode:'online-to-offline',method:kind==='answering'?'respondAnswering':'continueCoachChat',gap:'Server session silently replaced with new contextless local session',contextPreserved:continued.context===online.context,sessionPreserved:continued.sessionId===online.sessionId});
   }catch{ /* An honest recoverable error is preferable to inventing a new session. */ }
  }
 }
 console.log(JSON.stringify({ok:gaps.length===0,strictMalformedDiagnostic:strict,methods:inventory.methods.length,cases:count,clientFetchBoundaries:inventory.clientFetchBoundaries,configuredTimeouts:observations,gaps},null,2));
 if(gaps.length)process.exitCode=1;
}finally{globalThis.fetch=saved.fetch;globalThis.setTimeout=saved.setTimeout;console.debug=saved.debug;await fs.rm(temp,{recursive:true,force:true});}
