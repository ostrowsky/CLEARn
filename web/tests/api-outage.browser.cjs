// Fault injection, not proof of production API/provider health. No real audio leaves Chromium.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'platform/apps/client/dist');
const {chromium}=createRequire(path.join(root,'platform/apps/client/package.json'))('playwright');
const content=JSON.parse(fs.readFileSync(path.join(root,'web/data/content.json'),'utf8')),buttons=content.meta.ui.buttons;
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.ogg':'audio/ogg','.png':'image/png','.woff2':'font/woff2'};
(async()=>{
 const server=http.createServer((req,res)=>{let f=path.resolve(dist,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(dist+path.sep)&&f!==dist){res.writeHead(403).end();return;}if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(dist,'index.html');res.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const results=[];const recognitionMode=process.argv.includes('--browser-recognition')||process.argv.includes('--recognition-error');const recognitionError=process.argv.includes('--recognition-error');
 try{
  if(!process.argv.includes('--probe-admin-backup')) for(const [url,setup] of [['/asking/interrupt','clarify'],['/asking/after-talk','after'],['/asking/without-context','formation'],['/practice/asking/clarify','legacy'],['/practice/answering/mixed','answer'],['/practice/chat','chat']]){
   const context=await browser.newContext({permissions:['microphone'],viewport:{width:1280,height:1000}});
   await context.addInitScript(({supported,fail})=>{
    class Recognition {start(){window.__speechStarts=(window.__speechStarts||0)+1;}stop(){if(fail){this.onerror?.({error:'network'});return;}const first=[{transcript:'The release'}],second=[{transcript:'starts next week.'}];first.isFinal=true;second.isFinal=true;this.onresult?.({results:[first,second],resultIndex:1});this.onend?.();}abort(){this.onend?.();}}
    Object.defineProperty(window,'SpeechRecognition',{value:supported?Recognition:undefined,configurable:true});Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});
   },{supported:recognitionMode,fail:recognitionError});
   const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];const stt=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',route=>{if(new URL(route.request().url()).pathname==='/api/speech/stt')stt.push(route.request().postDataJSON());return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true'},body:JSON.stringify({message:'Synthetic API unavailable: type your answer instead.'})});});
   await page.route('**/_vercel/**',route=>route.fulfill({status:204}));
   await page.goto(base+url,{waitUntil:'networkidle'});
   if(setup==='clarify'&&!(await page.locator('textarea').count()))await page.getByText('You Want to Clarify the Missed Detail',{exact:true}).click();
   if(setup==='after'){await page.locator('textarea').first().fill('The upcoming API release.');await page.getByText(buttons.generateShortTalk,{exact:true}).click();}
   if(setup==='answer')await page.getByText(buttons.startDialogue,{exact:true}).click();
   if(setup==='chat')await page.getByText(buttons.startCoachChat,{exact:true}).click();
   await page.getByText(buttons.startRecording,{exact:true}).first().waitFor({state:'visible'});
   if(setup==='after')await page.getByText(buttons.reviewQuestion,{exact:true}).first().waitFor({state:'visible'});
   const draft=['after','answer','chat'].includes(setup)?page.locator('textarea:not([readonly])').last():page.locator('textarea').first();
   await draft.fill('Keep this typed draft after speech failure.');
   await page.getByText(buttons.startRecording,{exact:true}).first().click();
   await page.waitForTimeout(700);
   await page.getByText(buttons.stopRecording,{exact:true}).first().click();
   if(recognitionMode&&!recognitionError){
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('textarea')).some(el=>el.value==='The release starts next week.'));
    assert.equal(await draft.inputValue(),'The release starts next week.');assert.equal(stt.length,0);assert.equal(await page.evaluate(()=>window.__speechStarts),1);
   }else{
    await page.getByText(recognitionError?'Speech recognition error: network':content.meta.ui.feedback.speechApiUnavailable,{exact:true}).first().waitFor();
    assert.equal(stt.length,recognitionMode?0:1);if(stt.length)assert.ok(stt[0].audioBase64&&stt[0].mimeType.startsWith('audio/'));
    assert.equal(await draft.inputValue(),'Keep this typed draft after speech failure.');
   }
   assert.deepEqual(errors,[],'No unhandled errors in '+url);
   const start=page.getByText(buttons.startRecording,{exact:true}).first();
   assert.notEqual(await start.evaluate(el=>el.closest('[role="button"]')?.getAttribute('aria-disabled')),'true');
   results.push({url,stt:recognitionMode?(recognitionError?'browser error handled':'browser recognition (mocked)'):'503 surfaced with repeat/type guidance',noUnhandledErrors:true});await context.close();
  }
  if(process.argv.includes('--probe-admin-backup')){
   const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[],backupRequests=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',route=>{
    const endpoint=new URL(route.request().url()).pathname;
    if(['/api/content','/api/admin/content'].includes(endpoint))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(content)});
    if(endpoint==='/api/admin/auth/status')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({configured:true,authenticated:true,login:'audit'})});
    if(endpoint==='/api/debug/log')return route.fulfill({status:200,contentType:'application/json',body:'{"logged":true}'});
    if(endpoint.includes('/backup/'))backupRequests.push(endpoint);return route.abort('failed');
   });
   await page.route('**/_vercel/**',r=>r.fulfill({status:204}));
   await page.goto(base+'/admin',{waitUntil:'networkidle'});
   await page.getByText('Download media backup',{exact:true}).first().click();await page.waitForTimeout(400);
   const chooserPromise=page.waitForEvent('filechooser');await page.getByText('Restore media backup',{exact:true}).first().click();
   await (await chooserPromise).setFiles({name:'audit-only.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.waitForTimeout(400);
   await page.getByText(content.meta.ui.admin.actions.downloadBackup,{exact:true}).first().click();await page.waitForTimeout(400);
   assert.deepEqual(errors,[]);assert.equal(backupRequests.length,3);await page.getByText(/Cannot reach the CLEARn API/).first().waitFor();
   results.push({url:'/admin',operations:['media export','media import','full export'],requests:backupRequests,unhandledErrors:errors});
   await context.close();
  }
  console.log(JSON.stringify({scope:'fault-injection-only',apiHealthy:false,speechRecovered:recognitionMode&&!recognitionError,results},null,2));
 }finally{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
})().catch(e=>{console.error(e);process.exitCode=1;});
