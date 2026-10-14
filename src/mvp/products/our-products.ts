/**
 * docs/mvp/22 §3.15: the client's own products ("Our products"). Shown on the Dashboard as one-click searches and
 * named in outreach emails as what else he supplies. Never a search filter: any product can be searched.
 */
import { getDb, type Queryable } from '@/mvp/db';
import { itemWordsOf } from '@/mvp/discovery/item';

export interface OurProduct { id: string; name: string }
export const MAX_OUR_PRODUCTS = 40;

/** His products, in the order he added them. */
export async function listOurProducts(db: Queryable = getDb()): Promise<OurProduct[]> {
  return (await db.query<OurProduct>('select id, name from company_products order by created_at, name')).rows;
}

/** Add a product (the same words twice keep one entry, with the newer spelling). */
export async function addOurProduct(name: string, db: Queryable = getDb()): Promise<OurProduct> {
  const clean = name.replace(/\s+/g, ' ').trim();
  const normalized = itemWordsOf(clean);
  if (clean.length < 2 || clean.length > 80 || !normalized) throw new RangeError('Type a product name (2 to 80 characters).');
  const count = (await db.query<{ n: number }>('select count(*)::int as n from company_products')).rows[0].n;
  const existing = (await db.query<OurProduct>('select id, name from company_products where normalized_name=$1', [normalized])).rows[0];
  if (!existing && count >= MAX_OUR_PRODUCTS) throw new RangeError(`Up to ${MAX_OUR_PRODUCTS} products.`);
  return (await db.query<OurProduct>(`insert into company_products(name, normalized_name) values($1, $2)
    on conflict (normalized_name) do update set name=excluded.name returning id, name`, [clean, normalized])).rows[0];
}

export async function removeOurProduct(id: string, db: Queryable = getDb()): Promise<boolean> {
  return ((await db.query('delete from company_products where id=$1 returning id', [id])).rows.length > 0);
}

/** His other products for an email about one searched product: never the searched product itself. */
export function otherProducts(products: OurProduct[], searched: string, max = 5): string[] {
  const own = itemWordsOf(searched).replace(/s\b/g, '');
  return products.map((p) => p.name).filter((name) => itemWordsOf(name).replace(/s\b/g, '') !== own).slice(0, max);
}
