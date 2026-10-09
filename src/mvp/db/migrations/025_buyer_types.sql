-- Buyer types (docs/mvp/19 Phase 2): how each named company buys, and how closely it matches the exact
-- material typed. Suggestions from the source wording, not proof.
alter table research_candidates add column if not exists rating_buyer_type text
  check (rating_buyer_type in ('end_user','contractor','subcontractor','owner','reseller','competitor','not_buyer'));
alter table research_candidates add column if not exists rating_match text check (rating_match in ('named','product','work','none'));
