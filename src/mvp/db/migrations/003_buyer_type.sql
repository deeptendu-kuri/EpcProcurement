-- 003 · Buyer type on leads (docs/mvp/13 §11): who the lead is about.
--   epc_contractor = main EPC / consortium member that won the work
--   subcontractor  = company that won a subcontract
--   supplier       = manufacturer or distributor that won a supply order (the client can sell to it too)
--   owner          = project owner / tendering authority
-- Null on leads scored before this migration (they get a type on their next scoring).
alter table leads add column if not exists buyer_type text
  check (buyer_type in ('epc_contractor','subcontractor','supplier','owner'));
create index if not exists leads_buyer_type_idx on leads (buyer_type);
