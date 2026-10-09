import { getCatalogueItem } from './buyers-config';
import { materialCatalogue } from '@/mvp/discovery/material-catalogue';
import { interpretMaterial, normalizeWords } from '@/mvp/discovery/interpret';

/**
 * Keep the user's wording when it names this product ("seamless A106", "GI pipe"); when the words are
 * generic ("valves", "steel pipe") and the user picked a type, use the product's name instead.
 */
export function searchedProductLabel(productId:string,keyword:string,fallback?:string):string {
  if(fallback&&keyword.trim().toLowerCase()===fallback.trim().toLowerCase())return fallback;
  const catalogue=materialCatalogue();
  const entry=catalogue.find((e)=>e.id===productId);
  const words=normalizeWords(keyword);
  const namesIt=Boolean(entry&&[entry.name,entry.shortName,...entry.terms].some((t)=>normalizeWords(t)===words));
  const reading=interpretMaterial(catalogue,keyword);
  if(keyword.trim() && (namesIt || (reading.best?.id===productId && (reading.confidence==='exact'||reading.confidence==='strong'))))
    return keyword.trim().replace(/[\r\n<>]/g,' ').slice(0,160);
  const product=getCatalogueItem(productId);
  return fallback || product?.shortName || product?.name || productId;
}
