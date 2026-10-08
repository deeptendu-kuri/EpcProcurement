-- Bound conference-link polling; never invent a Meet URL or retry forever.
alter table funnel_threads add column meeting_checks integer not null default 0 check(meeting_checks>=0);
