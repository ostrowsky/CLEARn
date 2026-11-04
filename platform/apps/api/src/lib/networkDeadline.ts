import {AsyncLocalStorage} from 'node:async_hooks';
const scope=new AsyncLocalStorage<AbortSignal>();
export async function withNetworkBudget<T>(action:()=>Promise<T>,ms:number):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await scope.run(controller.signal,()=>Promise.race([action(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Network operation exceeded its total deadline.'));},ms);})]));}
 finally{clearTimeout(timer);controller.abort();}
}
// These endpoints are non-streaming. Buffer within the deadline so body stalls cannot bypass it.
export async function fetchWithDeadline(url:string|URL,init:RequestInit={},ms=5000):Promise<Response>{
 const controller=new AbortController(),outer=scope.getStore();
 const abort=()=>controller.abort();
 if(init.signal?.aborted||outer?.aborted)abort();
 init.signal?.addEventListener('abort',abort,{once:true});outer?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,Math.max(1,Math.min(ms,25000)));
 try{
  const response=await globalThis.fetch(url,{...init,signal:controller.signal});
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
  if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>32*1024*1024){await reader.cancel();throw new Error('Provider response exceeded 32 MiB.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
 }catch(error){if(controller.signal.aborted)throw new Error('Provider request/body timed out or was cancelled.');throw error;}
 finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);outer?.removeEventListener('abort',abort);}
}
