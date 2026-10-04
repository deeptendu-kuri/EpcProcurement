/** Read-only provider checks. Never sends email, creates a meeting, or connects to a database. */
import {createRequire} from "node:module";
import {existsSync} from "node:fs";
const require=createRequire(import.meta.url);
if(existsSync(".env.funnel.local"))process.loadEnvFile(".env.funnel.local");
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd(),false);
const live=process.argv.includes("--live");
const configured=name=>Boolean(process.env[name]?.trim());
const report={localOnly:true,noEmailSent:true,noCalendarWrites:true,configured:{groq:configured("GROQ_API_KEY"),hunter:configured("HUNTER_API_KEY"),
  tavily:configured("TAVILY_API_KEY"),resend:configured("RESEND_API_KEY"),receivingDomain:configured("RESEND_RECEIVING_DOMAIN"),
  calendarOAuth:configured("GOOGLE_CLIENT_ID")&&configured("GOOGLE_CLIENT_SECRET")},checks:{}};
if(live){
  for(const provider of [
    {name:"groq",key:"GROQ_API_KEY",url:"https://api.groq.com/openai/v1/models"},
    {name:"resendReceiving",key:"RESEND_API_KEY",url:"https://api.resend.com/emails/receiving?limit=1"},
  ]){
    if(!configured(provider.key)){report.checks[provider.name]={skipped:true,reason:"Key not configured"};continue;}
    try{const response=await fetch(provider.url,{redirect:"error",headers:{authorization:`Bearer ${process.env[provider.key].trim()}`},signal:AbortSignal.timeout(20_000)});
      report.checks[provider.name]={ok:response.ok,status:response.status};await response.body?.cancel();
    }catch{report.checks[provider.name]={ok:false,reason:"Network request failed; no key or provider response was logged"};}
  }
}
console.log(JSON.stringify(report,null,2));
