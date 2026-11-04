// Tests exported application under a production-like origin; collectors are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const { chromium } = createRequire(path.join(root,'platform/apps/client/package.json'))('playwright');
const content = JSON.parse(fs.readFileSync(path.join(root,'web/data/content.json'),'utf8'));
const copy = content.meta.ui.analytics, buttons = content.meta.ui.buttons;
const dist = path.join(root,'platform/apps/client/dist');
const output = path.join(root,'tmp-platform-ga4');
const realTag = process.env.GA4_REAL_TAG === '1';
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ogg':'audio/ogg'};
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const browser = await chromium.launch({headless:true});
 let tagRequests=0; const collected=[];
 async function setup(width=1440){
  const context = await browser.newContext({viewport:{width,height:1000}});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='www.googletagmanager.com'){
    tagRequests++;
    if(realTag) { await route.continue(); return; }
    await route.fulfill({status:200,contentType:'text/javascript',body:'/* intercepted test tag; inspect command queue */'}); return;
   }
   if(/(^|\.)(google-analytics.com|analytics.google.com)$/.test(url.hostname)){
    collected.push({url:url.href,body:route.request().postData()||''});
    await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*'}}); return;
   }
   if(url.pathname.startsWith('/api/')){await route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://clearn.me'},body:'{"error":"Service Suspended"}'});return;}
   if(url.hostname==='clearn.me' || url.hostname==='clearn-preview.vercel.app'){
    if(url.pathname.startsWith('/_vercel/')){await route.fulfill({status:204});return;}
    let file=path.resolve(dist,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(dist+path.sep)&&file!==dist){await route.abort();return;}
    if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(dist,'index.html');
    await route.fulfill({status:200,contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});return;
   }
   await route.abort();
  }); return context;
 }
 const commands=page=>page.evaluate(()=>Array.from(window.dataLayer||[],item=>Array.from(item)));
 const events=async page=>(await commands(page)).filter(item=>item[0]==='event');
 try{
  const context=await setup(); const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://clearn.me/?utm_source=qa&utm_medium=test&utm_campaign=ga4&email=PRIVATE#SECRET');
  await page.getByRole('heading',{name:copy.title,exact:true}).waitFor();
  assert.equal(tagRequests,0);assert.deepEqual(await events(page),[]);
  await page.getByRole('button',{name:copy.decline,exact:true}).click();
  await page.reload();await page.getByRole('button',{name:copy.settings,exact:true}).waitFor();assert.equal(tagRequests,0);
  await page.getByRole('button',{name:copy.settings,exact:true}).click();await page.getByRole('button',{name:copy.accept,exact:true}).click();
  await page.waitForFunction(()=>Array.from(window.dataLayer||[],item=>Array.from(item)).some(item=>item[0]==='event'&&item[1]==='page_view'));
  await page.waitForTimeout(500);assert.equal(tagRequests,1);
  assert.equal((await events(page)).filter(item=>item[1]==='page_view').length,1);
  await page.getByText(content.meta.ui.homeMenu.primaryCtaLabel||'Start with asking',{exact:true}).first().click();
  await page.waitForURL('**/asking');await page.waitForTimeout(100);
  await page.getByText('Interrupt and ask',{exact:true}).first().click();await page.waitForURL('**/asking/interrupt');
  if(!(await page.locator('textarea').count()))await page.getByText('You Want to Clarify the Missed Detail',{exact:true}).click();
  const example=content.sections.find(s=>s.id==='asking-interrupt').blocks.flatMap(b=>b.materials||[]).find(m=>m.type==='audio');
  await page.locator('textarea').first().fill('This is not a clarification question.');await page.getByText(buttons.checkAnswer,{exact:true}).first().click();
  await page.locator('textarea').first().fill(example.meta.clarification);await page.getByText(buttons.checkAnswer,{exact:true}).first().click();
  await page.getByText(buttons.showExpectedAnswer,{exact:true}).first().click();
  await page.waitForTimeout(300);
  let list=await events(page);
  assert.equal(list.filter(item=>item[1]==='page_view').length,3);
  assert.equal(list.filter(item=>item[1]==='answer_check').length,2);
  assert.deepEqual(list.filter(item=>item[1]==='answer_check').map(item=>item[2].correct),[false,true]);
  assert.equal(list.filter(item=>item[1]==='exercise_start').length,1);
  assert.equal(list.filter(item=>item[1]==='hint_view').length,1);
  assert.doesNotMatch(JSON.stringify(await commands(page)),/PRIVATE|SECRET|clarification question/);
  await page.goBack();await page.waitForURL('**/asking');await page.waitForTimeout(200);
  assert.equal((await events(page)).filter(item=>item[1]==='page_view').length,4);
  if(realTag){ await page.waitForTimeout(1800);assert.ok(collected.some(item=>item.url.includes('tid=G-5EJ2691BS9')), 'Real Google tag must emit collection requests, intercepted before delivery');assert.doesNotMatch(JSON.stringify(collected),/PRIVATE|SECRET|This%20is|clarification%20question/); }
  await page.getByRole('button',{name:copy.settings,exact:true}).click();await page.getByRole('button',{name:copy.decline,exact:true}).click();
  assert.equal(await page.evaluate(()=>window['ga-disable-G-5EJ2691BS9']),true);
  assert.deepEqual(await events(page),[]);
  await page.reload();await page.getByRole('button',{name:copy.settings,exact:true}).waitFor();assert.equal(tagRequests,1);
  assert.deepEqual(errors,[]);await context.close();
  const mobile=await setup(390);const p=await mobile.newPage();await p.goto('https://clearn.me/asking');await p.getByRole('heading',{name:copy.title,exact:true}).waitFor();await p.screenshot({path:path.join(output,'consent-mobile.png'),fullPage:true});
  await p.getByRole('button',{name:copy.accept,exact:true}).click();await p.waitForTimeout(300);const beforeAdmin=tagRequests;
  await p.goto('https://clearn.me/admin');await p.waitForTimeout(1500);assert.equal(tagRequests,beforeAdmin);assert.deepEqual(await events(p),[]);await mobile.close();
  const preview=await setup();const previewPage=await preview.newPage();await previewPage.goto('https://clearn-preview.vercel.app/asking');await previewPage.waitForTimeout(600);assert.equal(await previewPage.getByRole('button',{name:copy.accept,exact:true}).count(),0);assert.equal(tagRequests,beforeAdmin);await preview.close();
  console.log(JSON.stringify({passed:true,realGoogleTag:realTag,collectedRequestsIntercepted:collected.length,transportEvents:collected.flatMap(item=>[new URL(item.url).searchParams,...item.body.split('\n').filter(Boolean).map(line=>new URLSearchParams(line))]).map(params=>params.get('en')).filter(Boolean),checks:['opt-in','decline persists','one tag','SPA pageviews and back','correct/incorrect checks','start/hint','no learner text','revoke','admin exclusion','preview exclusion','mobile banner','API 503']},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
