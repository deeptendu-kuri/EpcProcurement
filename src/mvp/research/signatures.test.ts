// @vitest-environment node
import {createHash,createHmac} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {verifyResendWebhook,verifyQstash,bearerAuthorized} from './signatures';
const now=Date.now(),body='{"type":"email.received","data":{"email_id":"one"}}',key='this-is-a-test-key-only-1234567890';
describe('machine request authentication',()=>{
  it('verifies raw Resend payload and rejects alteration, future and stale timestamp',()=>{
    const ts=String(Math.floor(now/1000)),id='msg_test',secret=`whsec_${Buffer.from(key).toString('base64')}`;
    const signature=createHmac('sha256',key).update(`${id}.${ts}.${body}`).digest('base64');
    const headers=new Headers({'svix-id':id,'svix-timestamp':ts,'svix-signature':`v1,${signature}`});
    expect(verifyResendWebhook(headers,body,secret,now)).toBe(true);
    expect(verifyResendWebhook(headers,body+' ',secret,now)).toBe(false);
    expect(verifyResendWebhook(headers,body,secret,now+301000)).toBe(false);
    expect(verifyResendWebhook(headers,body,secret,now-301000)).toBe(false);
  });
  it('verifies QStash signature, exact audience/body and expiration',()=>{
    const url='https://example.com/api/mvp/research/worker';const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const claim=Buffer.from(JSON.stringify({iss:'Upstash',sub:url,exp:now/1000+30,nbf:now/1000-30,body:createHash('sha256').update(body).digest('base64url')})).toString('base64url');
    const jwt=`${head}.${claim}.${createHmac('sha256',key).update(`${head}.${claim}`).digest('base64url')}`;
    expect(verifyQstash(jwt,body,url,[key],now)).toBe(true);expect(verifyQstash(jwt,body,url,['wrong-key-that-is-long-enough'],now)).toBe(false);
    expect(verifyQstash(jwt,body+' ',url,[key],now)).toBe(false);expect(verifyQstash(jwt,body,url+'/wrong',[key],now)).toBe(false);expect(verifyQstash(jwt,body,url,[key],now+31000)).toBe(false);
  });
  it('does not accept browser cookies, short secrets or a malformed bearer',()=>{
    expect(bearerAuthorized(`Bearer ${key}`,key)).toBe(true);expect(bearerAuthorized('Bearer short','short')).toBe(false);expect(bearerAuthorized('cookie=value',key)).toBe(false);
  });
});
