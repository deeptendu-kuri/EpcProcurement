const state=globalThis as typeof globalThis&{resendNextSlot?:number};
/** Shared per-process spacing for receiving and sending; bounded retries still handle account-wide 429s. */
export async function paceResend() {
  if(process.env.VITEST)return;
  const now=Date.now();const slot=Math.max(now,state.resendNextSlot??0);state.resendNextSlot=slot+650;
  if(slot>now)await new Promise(resolve=>setTimeout(resolve,slot-now));
}
