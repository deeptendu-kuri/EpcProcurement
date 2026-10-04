-- A meeting request waits for consent rather than failing or inventing a meeting link.
alter table funnel_threads drop constraint funnel_threads_state_check;
alter table funnel_threads add constraint funnel_threads_state_check check (state in
  ('qualifying','needs_contact','active','engaged','awaiting_calendar','awaiting_time','meeting_pending','meeting_booked','stopped','review'));
