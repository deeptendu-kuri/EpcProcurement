'use client';
import type {SourceCard as Card} from '@/mvp/buyers/types';
import {splitAroundQuote} from '../evidence';
const labels:Record<Card['quotes'][number]['proves'],string>={award:'Award / order',project:'Project',value:'Value',date:'Date',role:'Role',material:'Material / activity',country:'Country',people:'People'};
/** React-escaped original sentences. No remote logos/tracking and no injected HTML. */
export function SourceCard({source}:{source:Card}){
  return <article className="rounded-xl border border-[var(--line)] bg-white p-4" aria-label={`Source: ${source.title}`}>
    <div className="flex items-start gap-3"><span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--subtle)] font-bold">{source.domain.slice(0,1).toUpperCase()}</span><div><p className="text-xs text-[var(--muted)]">{source.domain} · {source.kind.replaceAll('_',' ')}</p><h4 className="mt-1 font-semibold">{source.title}</h4>{source.publishedAt?<p className="mt-1 text-xs">Published {source.publishedAt.slice(0,10)} · not necessarily the award date</p>:null}</div></div>
    <div className="mt-4 space-y-3">{source.quotes.map(q=>{
      const parts=splitAroundQuote(q.sentence,q.highlight);if(!parts)return null;
      return <div key={`${q.evidenceId}:${q.proves}`}><p className="mb-1 text-xs font-semibold text-[var(--muted)]">{labels[q.proves]}</p><blockquote className="border-l-2 border-[var(--accent)] pl-3 text-sm leading-6">{parts[0]}<mark className="rounded bg-amber-100 text-slate-900">{parts[1]}</mark>{parts[2]}</blockquote></div>;
    })}</div>
    {/^https?:\/\//i.test(source.url)?<a className="mt-3 inline-block text-sm font-semibold text-[var(--accent-2)] underline" href={source.url} target="_blank" rel="noopener noreferrer">Open page ↗</a>:null}
  </article>;
}
export function SourceCards({sources}:{sources:Card[]}){return <div className="space-y-3">{sources.map(s=><SourceCard key={s.documentId} source={s}/>)}</div>;}
