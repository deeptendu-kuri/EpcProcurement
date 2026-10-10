import {afterEach,describe,expect,it,vi} from 'vitest';
import {apiJson,ApiError} from './api-client';

afterEach(()=>vi.unstubAllGlobals());

describe('Client API response cancellation',()=>{
  it('does not turn an aborted response body into an empty success',async()=>{
    const controller=new AbortController();
    const aborted=new DOMException('Example cancelled navigation','AbortError');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>{controller.abort(aborted);throw aborted;}})));
    await expect(apiJson('/api/mvp/buyers',{signal:controller.signal})).rejects.toBe(aborted);
  });
  it('rejects data if the request was cancelled while its body finished',async()=>{
    const controller=new AbortController();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>{controller.abort();return {rows:[]};}})));
    await expect(apiJson('/api/mvp/buyers',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  });
  it('shows a retryable error for invalid JSON on a successful response',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('Example invalid JSON',{status:200})));
    await expect(apiJson('/api/mvp/buyers')).rejects.toMatchObject({name:'ApiError',status:200,message:'The server returned an unreadable response. Try again.'});
  });
  it('keeps the status fallback for non-JSON server errors',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('Example unavailable',{status:503})));
    await expect(apiJson('/api/mvp/buyers')).rejects.toMatchObject({name:'ApiError',status:503,message:'Request failed (503).'});
  });
  it('returns valid JSON and preserves structured API errors',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({rows:[],facets:{roles:[]}}),{status:200})));
    await expect(apiJson('/api/mvp/buyers')).resolves.toEqual({rows:[],facets:{roles:[]}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Example invalid search'}),{status:400})));
    await expect(apiJson('/api/mvp/buyers')).rejects.toEqual(new ApiError('Example invalid search',400));
  });
});
