/** An in-process timer/queue is not a durable Vercel worker. Fail closed until transport is integrated. */
export const SERVERLESS_SETUP_MESSAGE = "Vercel background processing is not connected yet. Configure a durable job queue and inbound-email webhook before enabling research or automation.";
export function serverlessRuntime(env:NodeJS.ProcessEnv=process.env) { return env.VERCEL === "1"; }
export function requirePersistentWorker() { if(serverlessRuntime())throw new Error(SERVERLESS_SETUP_MESSAGE); }
