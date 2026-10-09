-- Shortlist rating (docs/mvp/18 §5): how likely each company a search found is to buy the searched
-- material, judged from the sentence that named it. A rating orders verification; it is not proof.
alter table research_candidates add column if not exists rating smallint check (rating between 0 and 100);
alter table research_candidates add column if not exists rating_role text;
alter table research_candidates add column if not exists rating_reason text;
alter table research_candidates add column if not exists rating_also text[] not null default '{}';
alter table research_candidates add column if not exists rating_source text check (rating_source in ('ai','rules'));
alter table research_candidates add column if not exists rated_at timestamptz;
create index if not exists research_candidates_rating_idx on research_candidates (run_id, rating desc nulls last);
