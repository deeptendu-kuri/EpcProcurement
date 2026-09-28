-- 004 · Buyer roles (docs/mvp/14 §2): widen leads.buyer_type to the six buyer roles.
--   owner | epc_contractor | subcontractor | manufacturer | fabricator | distributor
-- The old `supplier` (a company that won a supply order) becomes `manufacturer` when its name or the
-- quotes about it say it makes things (manufactures / mill / plant / produces / pipes, tubes, steel,
-- valves…), otherwise `distributor`. Scoring writes the new roles from now on.
alter table leads drop constraint if exists leads_buyer_type_check;

update leads l
   set buyer_type = case
     when exists (
       select 1 from companies c
        where c.id = l.buyer_company_id
          and (c.canonical_name ~* '(pipe|tube|tubular|steel|mill|valve|casting|forging|metal|seamless|manufactur)'
               or 'manufacturer' = any(c.types) and c.canonical_name ~* '(industr|works|factory|plant)')
     ) or exists (
       select 1 from fact_evidence fe join evidence e on e.id = fe.evidence_id
        where ((fe.entity_type = 'company' and fe.entity_id = l.buyer_company_id)
               or (fe.entity_type = 'project_party' and fe.entity_id in (
                     select pp.id from project_parties pp where pp.company_id = l.buyer_company_id)))
          and e.quote ~* '(manufactur|\mmakes?\M|\mmills?\M|\mplants?\M|produc)'
     ) then 'manufacturer'
     when exists (
       select 1 from companies c where c.id = l.buyer_company_id and 'fabricator' = any(c.types)
     ) then 'fabricator'
     else 'distributor'
   end
 where l.buyer_type = 'supplier';

alter table leads add constraint leads_buyer_type_check
  check (buyer_type in ('owner','epc_contractor','subcontractor','manufacturer','fabricator','distributor'));
