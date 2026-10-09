/**
 * Why a company's work needs the searched product, in plain words, from its own source wording.
 * "A.K.K. workshop … supports our pressure vessel manufacturing" becomes
 * "Pressure vessel fabricator: vessel shells and heads are rolled and pressed from steel plate."
 * This explains a supported inference; it is never a claim of an order, grade or quantity.
 */
import { getCatalogueItem } from '@/mvp/config/buyers-config';

interface Rule { test: RegExp; label: string; reason: string }
const RULES: Record<string, Rule[]> = {
  plates: [
    { test: /\b(?:ship\s?build\w*|shipyards?|ship\s?repair\w*|dry\s?docks?|drydocks?|vessel construction|hull\w*|offshore vessels?|barges?)\b/i,
      label: 'Shipbuilder', reason: 'Ship hulls, decks and bulkheads are built from steel plate.' },
    { test: /\bpressure vessels?\b/i, label: 'Pressure vessel fabricator', reason: 'Pressure vessel shells and heads are rolled and pressed from steel plate.' },
    { test: /\bboilers?\b/i, label: 'Boiler maker', reason: 'Boiler drums and shells are made from pressure-vessel steel plate.' },
    { test: /\b(?:storage tanks?|tank fabrication|tank farm|api 650)\b/i, label: 'Storage tank fabricator', reason: 'Storage tank shells, floors and roofs are made from steel plate.' },
    { test: /\b(?:heavy (?:engineering|fabrication)|heat exchangers?|columns? and reactors?|process equipment)\b/i,
      label: 'Heavy equipment fabricator', reason: 'Process equipment such as exchangers, columns and reactors is fabricated from steel plate.' },
    { test: /\b(?:steel plate fabrication|plate fabrication|plate work)\b/i, label: 'Plate fabricator', reason: 'Its fabrication work is done in steel plate.' },
  ],
  'line-pipe': [
    { test: /\b(?:cross.country|transmission|oil|gas|crude|product)\s+pipelines?\b|\bpipeline (?:construction|laying|EPC)\b/i,
      label: 'Pipeline contractor', reason: 'Pipeline construction consumes line pipe for the pipeline itself.' },
  ],
  'structural-steel': [
    { test: /\b(?:steel structures?|structural steel|steel erection|pre-?engineered buildings?)\b/i,
      label: 'Steel structure contractor', reason: 'Steel structure work uses beams, channels and angles.' },
  ],
};

export interface Application { label: string; reason: string }
/** The first application its source wording supports, or null when the wording names no consuming work. */
export function productApplication(productId: string, text: string | null | undefined): Application | null {
  const t = text ?? '';
  const rule = (RULES[productId] ?? []).find((r) => r.test.test(t));
  if (rule) return { label: rule.label, reason: rule.reason };
  return null;
}
/** One sentence for people: "Builds pressure vessels → needs steel plates: …". */
export function applicationSentence(productId: string, texts: (string | null | undefined)[]): string | null {
  const product = getCatalogueItem(productId)?.shortName ?? 'this product';
  for (const text of texts) {
    const app = productApplication(productId, text);
    if (app) return `Why they need ${product}: ${app.reason}`;
  }
  return null;
}
