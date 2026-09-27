alter table discovery_contact_enrichment_jobs
  add column if not exists list_id text references discovery_lead_lists(id) on delete set null;

create index if not exists discovery_contact_enrichment_jobs_list_idx on discovery_contact_enrichment_jobs(list_id, queued_at desc);
