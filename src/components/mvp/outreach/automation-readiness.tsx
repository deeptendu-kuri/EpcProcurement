import Link from 'next/link';
export interface AutomationReadinessStatus {enabled?:boolean;ready:boolean;worker:boolean;prospectDemo:boolean;prospectsPerSearch:number;recipient:string;calendar:string|null;configError:string|null;}
export function AutomationReadiness({status}:{status:AutomationReadinessStatus}){
  const active=status.enabled&&status.ready&&status.worker&&status.prospectDemo;
  return <section aria-label="Automatic email readiness" className={`rounded-xl border p-4 text-sm ${active?'border-emerald-200 bg-emerald-50/60':'border-amber-200 bg-amber-50'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{active?'Automatic demo email is on':'Automatic demo email needs setup'}</h2><p className="mt-1 break-all text-xs text-[var(--text-2)]">Demo inbox: <strong>{status.recipient}</strong> · Calendar {status.calendar?'connected':'not connected'}</p></div><Link href="/outreach" className="text-xs font-semibold underline">View email & meeting progress →</Link></div>
    {!active?<p className="mt-2">{status.configError||(!status.enabled?'Enable the approved-inbox demo in Email automation.':!status.worker?'The email worker is off.':!status.prospectDemo?'Real contact validation is required in the current mode.':'Check automation settings before searching.')} No automatic delivery is promised until setup is ready.</p>:null}
    <details className="mt-2"><summary className="cursor-pointer text-xs text-[var(--text-2)]">How automatic outreach works</summary>
      {active?<p className="mt-2 text-xs">When a new search finishes, its top {status.prospectsPerSearch} evidence-qualified {status.prospectsPerSearch===1?'company receives':'companies receive'} an introduction at the approved inbox only (best rated first). Missing buyer contacts do not block this approved-inbox demo. Existing conversations and historical searches are not emailed again.</p>:null}
      <p className="mt-2 text-xs">{status.calendar?'Calendar connected. Reply to the email with your requirements; request a meeting and confirm an offered time to receive a real Meet link.':'Calendar is not connected. Email may work, but booking a real meeting requires Google consent once.'} A saved company is not automatically a qualified buyer; rejected or unsupported matches receive no email.</p>
    </details>
  </section>;
}
