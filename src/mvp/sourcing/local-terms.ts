/**
 * Local-language search terms (docs/mvp/19 Phase 3). Business and project news in Saudi Arabia, Germany,
 * Brazil or Turkey is mostly written in Arabic, German, Portuguese or Turkish, so English queries miss it.
 * One small AI call translates the material, the work that uses it and the award/tender/stockist words
 * into the country's language; the result is cached per material and language in term_cache.
 * Without AI (demo mode or allowance used up) searches stay in English.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Queryable } from '@/mvp/db';
import type { LLMProvider } from '@/mvp/llm/types';

export interface LocalTerms { lang: string; material: string; work: string; awarded: string; tender: string; stockists: string }
const shape = z.object({ material: z.string().min(2).max(80), work: z.string().min(2).max(80), awarded: z.string().min(2).max(60), tender: z.string().min(2).max(60), stockists: z.string().min(2).max(60) });

const LANG_NAMES: Record<string, string> = {
  ar: 'Arabic', fr: 'French', es: 'Spanish', pt: 'Portuguese', de: 'German', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', is: 'Icelandic', it: 'Italian',
  el: 'Greek', tr: 'Turkish', pl: 'Polish', cs: 'Czech', sk: 'Slovak', hu: 'Hungarian', ro: 'Romanian', bg: 'Bulgarian', sr: 'Serbian', hr: 'Croatian', sl: 'Slovenian', bs: 'Bosnian',
  mk: 'Macedonian', sq: 'Albanian', uk: 'Ukrainian', lt: 'Lithuanian', lv: 'Latvian', et: 'Estonian', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', vi: 'Vietnamese',
  th: 'Thai', id: 'Indonesian', ms: 'Malay', bn: 'Bengali', ne: 'Nepali', my: 'Burmese', km: 'Khmer', lo: 'Lao', mn: 'Mongolian', fa: 'Persian', he: 'Hebrew', az: 'Azerbaijani',
  hy: 'Armenian', ka: 'Georgian', uz: 'Uzbek', tk: 'Turkmen', tg: 'Tajik',
};
export const languageName = (lang: string) => LANG_NAMES[lang] ?? lang;

export const termKey = (lang: string, material: string, work: string) =>
  `terms-v1:${lang}:${createHash('sha256').update(`${material.toLowerCase().trim()}|${work.toLowerCase().trim()}`).digest('hex').slice(0, 24)}`;

/**
 * Terms in `lang` for `material` and `work`; cached. Returns null for English, without a provider, or
 * when the answer is unusable (the caller then searches in English only).
 */
export async function localTerms(db: Queryable, lang: string, material: string, work: string, provider: LLMProvider | null, runId?: string): Promise<LocalTerms | null> {
  if (!lang || lang === 'en') return null;
  const key = termKey(lang, material, work);
  const cached = (await db.query<{ value: unknown }>('select value from term_cache where key=$1', [key])).rows[0];
  if (cached) { const parsed = shape.safeParse(cached.value); if (parsed.success) return { lang, ...parsed.data }; }
  if (!provider || provider.name === 'mock') return null;
  try {
    const res = await provider.complete({
      system: `Translate industrial procurement search terms into ${languageName(lang)} as a local trade journalist would write them in news headlines. Use the common local trade words, not literal translations. Answer JSON only: {"material","work","awarded","tender","stockists"}.`,
      user: JSON.stringify({ material, work, awarded: 'contract awarded', tender: 'tender', stockists: `${material} stockists and suppliers` }),
      json: true, maxTokens: 300, temperature: 0, purpose: 'local_terms', runId, singleAttempt: true,
    });
    const parsed = shape.safeParse(JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1)));
    if (!parsed.success) return null;
    await db.query('insert into term_cache(key,value) values($1,$2::jsonb) on conflict (key) do update set value=excluded.value', [key, JSON.stringify(parsed.data)]);
    return { lang, ...parsed.data };
  } catch {
    return null;
  }
}

/** A local-language news query: "<material> <work> <awarded>" (short; news search engines prefer few words). */
export function localNewsQuery(t: LocalTerms): string {
  return `${t.material} ${t.awarded}`.replace(/\s+/g, ' ').trim();
}
