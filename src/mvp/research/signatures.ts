import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
const equal=(a:Buffer,b:Buffer)=>a.length===b.length&&timingSafeEqual(a,b);
/** Svix signed raw bytes; timestamp narrows replay window, database event ID handles duplicates. */
export function verifyResendWebhook(headers:Headers,raw:string,secret:string,now=Date.now()) {
  const id=headers.get('svix-id'),ts=headers.get('svix-timestamp'),sig=headers.get('svix-signature');
  if(!id||id.length>200||!ts||!/^\d+$/.test(ts)||!sig||!secret.startsWith('whsec_'))return false;
  if(Math.abs(now/1000-Number(ts))>300)return false;
  const key=Buffer.from(secret.slice(6),'base64');if(key.length<16)return false;
  const expected=createHmac('sha256',key).update(`${id}.${ts}.${raw}`).digest();
  return sig.split(' ').some(value=>{const [version,signature]=value.split(',');return version==='v1'&&Boolean(signature)&&equal(expected,Buffer.from(signature,'base64'));});
}
/** Manual HS256 verification follows the official QStash claim contract; no decoded-only JWTs. */
export function verifyQstash(signature:string|null,raw:string,url:string,keys:string[],now=Date.now()) {
  if(!signature||signature.length>8192)return false;
  try{
    const parts=signature.split('.');if(parts.length!==3)return false;
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    if(header.alg!=='HS256')return false;
    const expected=Buffer.from(parts[2],'base64url');
    if(!keys.filter(k=>k.length>=16).some(k=>equal(createHmac('sha256',k).update(`${parts[0]}.${parts[1]}`).digest(),expected)))return false;
    const claim=JSON.parse(Buffer.from(parts[1],'base64url').toString());const seconds=now/1000;
    return claim.iss==='Upstash'&&claim.sub===url&&typeof claim.exp==='number'&&claim.exp>seconds&&typeof claim.nbf==='number'&&claim.nbf<=seconds
      &&typeof claim.body==='string'&&equal(Buffer.from(claim.body.replace(/=+$/,''),'base64url'),createHash('sha256').update(raw).digest());
  }catch{return false;}
}
export function bearerAuthorized(header:string|null,secret:string|undefined) {
  return Boolean(secret&&secret.length>=32&&header?.startsWith('Bearer ')&&equal(createHash('sha256').update(secret).digest(),createHash('sha256').update(header.slice(7)).digest()));
}
