-- A search can be paused by the user, or automatically after a chosen number of leads: no new steps
-- start, steps already running finish, and Resume carries on from the same saved work.
alter table research_sessions drop constraint if exists research_sessions_state_check;
alter table research_sessions add constraint research_sessions_state_check
  check (state in ('active','paused','partial','done','cancelled','failed'));
