import { getCatalogueItem } from './buyers-config';
import { resolveMaterial } from '@/mvp/discovery/material';

/** Preserve supported search wording instead of replacing it with a broad family. */
export function searchedProductLabel(productId:string,keyword:string,fallback?:string):string {
  if(fallback&&keyword.trim().toLowerCase()===fallback.trim().toLowerCase())return fallback;
  const material=resolveMaterial(keyword,productId);
  if(material.status==='resolved' && material.productId===productId && keyword.trim())
    return keyword.trim().replace(/[\r\n<>]/g,' ').slice(0,160);
  const product=getCatalogueItem(productId);
  return fallback || product?.shortName || product?.name || productId;
}
