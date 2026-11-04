import assert from 'node:assert/strict';
import http from 'node:http';
import { checkProductionApi, formatSummary, validateBaseUrl, productionProbes } from '../../platform/scripts/check-production-api.mjs';
const origin = 'https://clearn.me';
let mode = 'healthy'; let requests = [];
const server = http.createServer((req,res)=>{
 requests.push({method:req.method,path:req.url,headers:req.headers});
 if(mode==='stall')return;
 const cors = mode==='cors' ? {} : {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'};
 if(mode==='suspended'){res.writeHead(503,{'Content-Type':'text/html'}).end('<h1>Service Suspended</h1>');return;}
 if(mode==='spa'){res.writeHead(200,{...cors,'Content-Type':'text/html'}).end('<html><div id="root"></div></html>');return;}
 if(mode==='redirect'){res.writeHead(302,{...cors,Location:'/login'}).end();return;}
 if(req.method==='OPTIONS'){res.writeHead(204,{...cors,'Access-Control-Allow-Methods':mode==='preflight'?'GET':'GET,POST','Access-Control-Allow-Headers':'Content-Type'}).end();return;}
 res.setHeader('Content-Type','application/json');Object.entries(cors).forEach(([k,v])=>res.setHeader(k,v));
 if(mode==='body-stall'){res.writeHead(200);res.write('{');return;}
 if(mode==='bad-json'){res.end('oops');return;}
 const protectedPath=['/api/admin/content','/api/debug/logs'].includes(req.url);
 res.statusCode=protectedPath?401:200;
 const payload=protectedPath?{statusCode:401}:req.url==='/api/health'?{status:'ok'}:req.url==='/api/content'?{meta:{},sections:[{id:'home',blocks:[]}]}:{configured:true,authenticated:false};
 res.end(JSON.stringify(mode==='wrong-shape'?{}:payload));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const baseUrl='http://127.0.0.1:'+server.address().port;
 let report=await checkProductionApi({baseUrl,origin,timeoutMs:500});
 assert.equal(report.ok,true);assert.equal(report.results.length,productionProbes.length);assert.ok(formatSummary(report).includes('provider execution unverified'));
 assert.ok(requests.every(r=>['GET','OPTIONS'].includes(r.method)));assert.ok(requests.every(r=>r.headers.origin===origin&&!r.headers.cookie&&!r.headers.authorization));
 for(mode of ['suspended','spa','cors','redirect','preflight','bad-json','wrong-shape','stall','body-stall']){
  report=await checkProductionApi({baseUrl,origin,timeoutMs:50});assert.equal(report.ok,false,mode+' must not pass production availability');
  assert.ok(report.results.some(r=>r.reasons.length>0));
  if(mode==='stall'||mode==='body-stall')assert.ok(report.results.some(r=>r.reasons.includes('Request/body timed out')));
 }
 assert.throws(()=>validateBaseUrl('https://user:secret@example.com'));assert.throws(()=>validateBaseUrl('https://example.com?token=secret'));
 await assert.rejects(checkProductionApi({baseUrl:origin,origin}));
 console.log('Production API smoke tests passed: healthy, suspended, SPA HTML, CORS, redirect, preflight, bad JSON, shape, header/body timeout, safe read-only probes.');
}finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
