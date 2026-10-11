import { chatCompletion } from "./openai-compatible";
import type { LLMProvider, LLMRequest } from "./types";
import { LLMHttpError } from "./types";

// Shared across freshly created providers/roles, scoped to the account, never to
// a secret token. Stops a failed comparison on every page consuming the run budget.
const circuits=new Map<string,{until:number;status:number}>();
export function resetCloudflareCircuitsForTests():void {circuits.clear();}

export function cloudflareUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
}

/** Cloudflare Workers AI (OpenAI-compatible endpoint). Default model "@cf/openai/gpt-oss-20b" (06 §2). */
export function createCloudflareProvider(
  accountId: string,
  apiToken: string,
  model: string,
  fetchImpl?: typeof fetch,
): LLMProvider {
  // gpt-oss: keep reasoning short, as on Groq. At the default effort a 20-company rating used ~2.9k of its
  // 3.9k answer tokens on reasoning, and a longer one ran out before the JSON (10 Oct live audit).
  const extraBody = model.includes("gpt-oss") ? { reasoning_effort: "low" } : undefined;
  const available=()=>!circuits.has(accountId)||circuits.get(accountId)!.until<=Date.now();
  return {
    name: "cloudflare",
    model,
    available,
    async complete(request: LLMRequest) {
      const previous=circuits.get(accountId);
      if(!available())throw new LLMHttpError('cloudflare',previous!.status,'Cloudflare temporarily unavailable; circuit open.',previous!.until-Date.now());
      try {
        const result=await chatCompletion({ provider: "cloudflare", url: cloudflareUrl(accountId), apiKey: apiToken, model, request, fetchImpl, extraBody });
        circuits.delete(accountId);return result;
      } catch(error) {
        if(error instanceof LLMHttpError&&[429,502,503,504].includes(error.status)){
          const tomorrow=new Date();tomorrow.setUTCHours(24,0,0,0);
          const daily=/daily|neurons|quota|allowance|per day/i.test(error.message);
          const delay=Math.max(1000,error.retryAfterMs??(daily?tomorrow.getTime()-Date.now():error.status===429?5*60_000:60_000));
          circuits.set(accountId,{until:Date.now()+delay,status:error.status});
        }
        throw error;
      }
    },
  };
}
