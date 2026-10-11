// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCloudflareProvider,resetCloudflareCircuitsForTests} from './cloudflare';
import {extractDocument} from '@/mvp/pipeline/extract';
import {withQuota} from './quota';
import type {LLMProvider} from './types';
beforeEach(()=>{resetCloudflareCircuitsForTests();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-11T09:00:00Z'));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe('Cloudflare outage circuit and optional extraction',()=>{
  it('shares a quota refusal across newly created providers and reopens at UTC reset',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{message:'Daily neurons quota exhausted'}}),{status:429}));
    const first=createCloudflareProvider('Example-account','Example-token','model-a',fetcher);
    await expect(first.complete({system:'s',user:'u',singleAttempt:true})).rejects.toMatchObject({status:429});
    const next=createCloudflareProvider('Example-account','Example-token','model-b',fetcher);
    expect(next.available?.()).toBe(false);
    await expect(next.complete({system:'s',user:'u'})).rejects.toThrow('circuit open');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(createCloudflareProvider('Example-other','Example-token','model-b',fetcher).available?.()).toBe(true);
    expect(withQuota(next,'extract_b').available?.()).toBe(false);
    vi.setSystemTime(new Date('2026-10-12T00:00:01Z'));expect(next.available?.()).toBe(true);
  });
  it('honours Retry-After for transient throttling instead of hammering each page',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:'slow down'}),{status:429,headers:{'Retry-After':'120'}}));
    const provider=createCloudflareProvider('Example-short','Example-token','model',fetcher);
    await expect(provider.complete({system:'s',user:'u',singleAttempt:true})).rejects.toMatchObject({retryAfterMs:120000});
    vi.advanceTimersByTime(119000);expect(provider.available?.()).toBe(false);
    vi.advanceTimersByTime(1001);expect(provider.available?.()).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not spend comparison calls or people extraction in buyer-only mode',async()=>{
    const main=vi.fn<LLMProvider['complete']>(async()=>({text:'{}',tokensIn:1,tokensOut:1}));
    const comparison=vi.fn();
    const a:LLMProvider={name:'groq',model:'Example-primary',complete:main};
    const b:LLMProvider={name:'cloudflare',model:'Example-backup',available:()=>false,complete:comparison};
    const notes:string[]=[];
    await extractDocument({url:'https://example.com/news',text:'Example EPC won a gas pipeline EPC contract in India. Example Person, Chief Executive Officer, announced the contract.'},
      {includePeople:false,singleAttempt:true,provider:role=>role==='extract_b'?b:a,onNote:async note=>{notes.push(note);}});
    expect(comparison).not.toHaveBeenCalled();
    expect(main.mock.calls.some(([request])=>/P3/i.test(request.purpose??''))).toBe(false);
    expect(notes.join(' ')).toContain('circuit open');
  });
});
