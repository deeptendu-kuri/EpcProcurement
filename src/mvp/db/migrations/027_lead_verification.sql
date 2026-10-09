-- How a lead is proven (docs/mvp/19 §6): its own website ('website'), a list or directory entry that
-- describes its work with the material ('listing'), or only the shortlist rating ('rating', shown as
-- "likely, not verified" and never emailed automatically).
alter table search_opportunities add column if not exists verification text not null default 'website'
  check (verification in ('website','listing','rating'));
