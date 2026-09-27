import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type CrmPayload =
  | { type: "saved-search"; payload: Record<string, unknown> }
  | { type: "candidate"; payload: Record<string, unknown> }
  | { type: "converted-lead"; payload: Record<string, unknown> }
  | { type: "decision-maker"; payload: Record<string, unknown> }
  | { type: "contact-enrichment-job"; payload: Record<string, unknown> }
  | { type: "email-verification-job"; payload: Record<string, unknown> }
  | { type: "lead-list"; payload: Record<string, unknown> }
  | { type: "lead-list-member"; payload: Record<string, unknown> }
  | { type: "crm-activity"; payload: Record<string, unknown> };

export async function GET(request: Request) {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, mode: "local-fallback", savedSearches: [], candidates: [], convertedLeads: [] });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const [savedSearchesResult, candidatesResult, convertedLeadsResult] = await Promise.all([
    supabase.from("saved_discovery_searches").select("*").order("created_at", { ascending: false }),
    supabase.from("discovery_candidates").select("*").order("saved_at", { ascending: false }),
    supabase.from("converted_discovery_leads").select("*").order("converted_at", { ascending: false }),
  ]);

  if (savedSearchesResult.error || candidatesResult.error || convertedLeadsResult.error) {
    return NextResponse.json({ ok: false, error: "CRM persistence is not ready for this environment." }, { status: 200 });
  }

  const savedSearches = (savedSearchesResult.data ?? []).map(fromSavedSearchRow);
  const candidates = (candidatesResult.data ?? []).map(fromCandidateRow);
  const convertedLeads = (convertedLeadsResult.data ?? []).map(fromConvertedLeadRow);
  const [contactJobsResult, emailJobsResult] = await Promise.all([
    supabase.from("discovery_contact_enrichment_jobs").select("*").order("queued_at", { ascending: false }),
    supabase.from("discovery_email_verification_jobs").select("*").order("queued_at", { ascending: false }),
  ]);
  const [decisionMakersResult, leadListsResult, leadListMembersResult, crmActivitiesResult] = await Promise.all([
    supabase.from("discovery_decision_makers").select("*").order("created_at", { ascending: false }),
    supabase.from("discovery_lead_lists").select("*").order("created_at", { ascending: false }),
    supabase.from("discovery_lead_list_members").select("*").order("added_at", { ascending: false }),
    supabase.from("discovery_crm_activities").select("*").order("created_at", { ascending: false }),
  ]);
  const contactEnrichmentJobs = contactJobsResult.error ? [] : (contactJobsResult.data ?? []).map(fromQueueJobRow);
  const emailVerificationJobs = emailJobsResult.error ? [] : (emailJobsResult.data ?? []).map(fromQueueJobRow);
  const decisionMakers = decisionMakersResult.error ? [] : (decisionMakersResult.data ?? []).map(fromDecisionMakerRow);
  const leadLists = leadListsResult.error ? [] : (leadListsResult.data ?? []).map(fromLeadListRow);
  const leadListMembers = leadListMembersResult.error ? [] : (leadListMembersResult.data ?? []).map(fromLeadListMemberRow);
  const crmActivities = crmActivitiesResult.error ? [] : (crmActivitiesResult.data ?? []).map(fromCrmActivityRow);

  if (id) {
    const converted = convertedLeads.find((lead) => lead.id === id);
    const candidate = converted ?? candidates.find((item) => item.id === id);
    return NextResponse.json({
      ok: true,
      mode: "database",
      candidate,
      converted,
      decisionMakers: decisionMakers.filter((person) => person.leadId === id),
      contactEnrichmentJobs: contactEnrichmentJobs.filter((job) => job.leadId === id),
      emailVerificationJobs: emailVerificationJobs.filter((job) => job.leadId === id),
      crmActivities: crmActivities.filter((activity) => activity.leadId === id),
    });
  }

  return NextResponse.json({ ok: true, mode: "database", savedSearches, candidates, convertedLeads, decisionMakers, contactEnrichmentJobs, emailVerificationJobs, leadLists, leadListMembers, crmActivities });
}

export async function POST(request: Request) {
  const supabase = createSupabaseServiceClient();
  const body = (await request.json().catch(() => null)) as CrmPayload | null;

  if (!body?.type || !body.payload) {
    return NextResponse.json({ ok: false, error: "Invalid CRM payload" }, { status: 400 });
  }

  if (!supabase) {
    return NextResponse.json({ ok: true, mode: "local-fallback" });
  }

  const table = tableForPayload(body.type);
  if (body.type === "decision-maker") {
    const { data: existing } = await supabase.from("discovery_decision_makers")
      .select("email,email_status,verified_at,verification_source").eq("id", String(body.payload.id)).maybeSingle();
    const unchanged = existing && existing.email === (body.payload.email || null);
    if (body.payload.emailStatus === "Verified" && !(unchanged && existing.email_status === "Verified")) {
      return NextResponse.json({ ok: false, error: "Verified status requires a verification result, not a manual edit." }, { status: 400 });
    }
    body.payload.verifiedAt = unchanged ? existing.verified_at : null;
    body.payload.verificationSource = unchanged ? existing.verification_source : null;
    if (!unchanged) body.payload.emailStatus = body.payload.email ? "Verification Pending" : "Email Not Found";
  }
  if (body.type === "converted-lead" && body.payload.emailStatus === "Verified") {
    const { data: verifiedContact } = await supabase.from("discovery_decision_makers")
      .select("id").eq("lead_id", String(body.payload.id)).eq("email_status", "Verified").not("email", "is", null).limit(1);
    if (!verifiedContact?.length) body.payload.emailStatus = "Email Not Found";
  }
  const payload = normalizePayload(body.type, body.payload);
  const { error } = await supabase.from(table).upsert(payload as never, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ ok: false, error: "CRM persistence is not ready for this environment." }, { status: 200 });
  }

  return NextResponse.json({ ok: true, mode: "database" });
}

export async function DELETE(request: Request) {
  const supabase = createSupabaseServiceClient();
  const body = (await request.json().catch(() => null)) as { type?: CrmPayload["type"]; id?: string } | null;

  if (!body?.type || !body.id) {
    return NextResponse.json({ ok: false, error: "Invalid CRM delete payload" }, { status: 400 });
  }

  if (!supabase) {
    return NextResponse.json({ ok: true, mode: "local-fallback" });
  }

  const table = tableForPayload(body.type);
  const { error } = await supabase.from(table).delete().eq("id", body.id);

  if (error) {
    return NextResponse.json({ ok: false, error: "CRM persistence is not ready for this environment." }, { status: 200 });
  }

  return NextResponse.json({ ok: true, mode: "database" });
}

function fromSavedSearchRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    label: row.label,
    query: row.query ?? "",
    regions: row.regions ?? [],
    keywords: row.keywords ?? [],
    filters: row.filters ?? {},
    createdAt: row.created_at,
  };
}

function fromCandidateRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    companyName: row.company_name,
    country: row.country ?? "Location pending",
    projectName: row.project_name ?? "Project name pending",
    signalType: row.signal_type ?? "Industrial signal",
    leadType: row.lead_type ?? (row.parent_company_name ? "contractor" : "owner"),
    parentLeadId: row.parent_lead_id,
    parentCompanyName: row.parent_company_name,
    parentProjectName: row.parent_project_name,
    contractorRole: row.contractor_role,
    contractorScope: row.contractor_scope,
    packageHint: row.package_hint,
    stage: row.stage ?? "New",
    notes: row.notes ?? "",
    confidence: row.confidence,
    requirementSummary: row.requirement_summary ?? "Product details pending",
    awardedContractors: Array.isArray(row.awarded_contractors) ? row.awarded_contractors : [],
    sourceUrl: row.source_url,
    savedAt: row.saved_at,
  };
}

function fromConvertedLeadRow(row: Record<string, unknown>) {
  return {
    ...fromCandidateRow(row),
    stage: row.crm_status ?? "Contact Needed",
    crmStatus: row.crm_status ?? "Contact Needed",
    enrichmentStatus: row.enrichment_status ?? "Not Started",
    emailStatus: row.email_status ?? "Email Not Found",
    targetRoles: row.target_roles ?? [],
    convertedAt: row.converted_at,
  };
}

function fromQueueJobRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    listId: row.list_id,
    leadId: row.lead_id,
    companyName: row.company_name,
    projectName: row.project_name,
    targetRoles: row.target_roles ?? [],
    emailStatus: row.email_status,
    status: row.status ?? "Queued",
    queuedAt: row.queued_at,
    completedAt: row.completed_at,
    result: row.result ?? {},
    error: row.error,
  };
}

function fromDecisionMakerRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    leadId: row.lead_id,
    companyName: row.company_name,
    name: row.name,
    title: row.title,
    department: row.department,
    seniority: row.seniority,
    location: row.location,
    linkedinUrl: row.linkedin_url,
    email: row.email,
    emailStatus: row.email_status ?? "Email Not Found",
    phone: row.phone,
    phoneStatus: row.phone_status ?? "Not Found",
    phoneSourceUrl: row.phone_source_url,
    linkedinStatus: row.linkedin_status ?? (row.linkedin_url ? "Profile Found" : "Not Found"),
    dataSourceType: row.data_source_type ?? "Manual research",
    confidence: typeof row.confidence === "number" ? row.confidence : 50,
    confidenceBreakdown: row.confidence_breakdown ?? {},
    evidenceSignals: row.evidence_signals ?? [],
    evidenceNotes: row.evidence_notes,
    emailCandidateType: row.email_candidate_type ?? "unknown",
    verificationSource: row.verification_source,
    sourceUrl: row.source_url,
    status: row.status ?? "Found",
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

function fromLeadListRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromLeadListMemberRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    listId: row.list_id,
    memberType: row.member_type,
    leadId: row.lead_id,
    contactId: row.contact_id,
    addedAt: row.added_at,
  };
}

function fromCrmActivityRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    leadId: row.lead_id,
    contactId: row.contact_id,
    activityType: row.activity_type,
    title: row.title,
    body: row.body ?? "",
    outcome: row.outcome,
    nextStep: row.next_step,
    dueAt: row.due_at,
    sourceUrl: row.source_url,
    createdAt: row.created_at,
  };
}

function tableForPayload(type: CrmPayload["type"]) {
  if (type === "saved-search") return "saved_discovery_searches";
  if (type === "candidate") return "discovery_candidates";
  if (type === "decision-maker") return "discovery_decision_makers";
  if (type === "contact-enrichment-job") return "discovery_contact_enrichment_jobs";
  if (type === "email-verification-job") return "discovery_email_verification_jobs";
  if (type === "lead-list") return "discovery_lead_lists";
  if (type === "lead-list-member") return "discovery_lead_list_members";
  if (type === "crm-activity") return "discovery_crm_activities";
  return "converted_discovery_leads";
}

function normalizePayload(type: CrmPayload["type"], payload: Record<string, unknown>) {
  if (type === "saved-search") {
    return {
      id: payload.id,
      label: payload.label,
      query: payload.query,
      regions: payload.regions,
      keywords: payload.keywords,
      filters: payload.filters ?? {},
    };
  }

  if (type === "candidate") {
    return {
      id: payload.id,
      company_name: payload.companyName,
      country: payload.country,
      project_name: payload.projectName,
      signal_type: payload.signalType,
      lead_type: payload.leadType ?? "owner",
      parent_lead_id: payload.parentLeadId ?? null,
      parent_company_name: payload.parentCompanyName ?? null,
      parent_project_name: payload.parentProjectName ?? null,
      contractor_role: payload.contractorRole ?? null,
      contractor_scope: payload.contractorScope ?? null,
      package_hint: payload.packageHint ?? null,
      stage: payload.stage,
      notes: payload.notes,
      confidence: payload.confidence,
      requirement_summary: payload.requirementSummary,
      awarded_contractors: payload.awardedContractors ?? [],
      source_url: payload.sourceUrl,
      saved_at: payload.savedAt,
    };
  }

  if (type === "contact-enrichment-job") {
    return {
      id: payload.id,
      list_id: payload.listId ?? null,
      lead_id: payload.leadId,
      company_name: payload.companyName,
      project_name: payload.projectName,
      target_roles: payload.targetRoles,
      status: payload.status,
      queued_at: payload.queuedAt,
      result: payload.result ?? {},
    };
  }

  if (type === "decision-maker") {
    return {
      id: payload.id,
      lead_id: payload.leadId,
      company_name: payload.companyName,
      name: payload.name,
      title: payload.title,
      department: payload.department,
      seniority: payload.seniority,
      location: payload.location,
      linkedin_url: payload.linkedinUrl,
      email: payload.email || null,
      email_status: payload.emailStatus,
      phone: payload.phone || null,
      phone_status: payload.phoneStatus ?? "Not Found",
      phone_source_url: payload.phoneSourceUrl || null,
      linkedin_status: payload.linkedinStatus ?? (payload.linkedinUrl ? "Profile Found" : "Not Found"),
      data_source_type: payload.dataSourceType ?? "Manual research",
      confidence: payload.confidence ?? 50,
      confidence_breakdown: payload.confidenceBreakdown ?? {},
      evidence_signals: payload.evidenceSignals ?? [],
      evidence_notes: payload.evidenceNotes ?? null,
      email_candidate_type: payload.emailCandidateType ?? "unknown",
      verification_source: payload.verificationSource,
      source_url: payload.sourceUrl,
      status: payload.status,
      verified_at: payload.verifiedAt,
      created_at: payload.createdAt,
    };
  }

  if (type === "email-verification-job") {
    return {
      id: payload.id,
      lead_id: payload.leadId,
      company_name: payload.companyName,
      project_name: payload.projectName,
      email_status: payload.emailStatus,
      status: payload.status,
      queued_at: payload.queuedAt,
      result: payload.result ?? {},
    };
  }

  if (type === "lead-list") {
    return {
      id: payload.id,
      name: payload.name,
      description: payload.description,
      created_at: payload.createdAt,
      updated_at: payload.updatedAt,
    };
  }

  if (type === "lead-list-member") {
    return {
      id: payload.id,
      list_id: payload.listId,
      member_type: payload.memberType,
      lead_id: payload.leadId ?? null,
      contact_id: payload.contactId ?? null,
      added_at: payload.addedAt,
    };
  }

  if (type === "crm-activity") {
    return {
      id: payload.id,
      lead_id: payload.leadId,
      contact_id: payload.contactId ?? null,
      activity_type: payload.activityType,
      title: payload.title,
      body: payload.body,
      outcome: payload.outcome,
      next_step: payload.nextStep,
      due_at: payload.dueAt,
      source_url: payload.sourceUrl,
      created_at: payload.createdAt,
    };
  }

  return {
    id: payload.id,
    company_name: payload.companyName,
    country: payload.country,
    project_name: payload.projectName,
    signal_type: payload.signalType,
    lead_type: payload.leadType ?? "owner",
    parent_lead_id: payload.parentLeadId ?? null,
    parent_company_name: payload.parentCompanyName ?? null,
    parent_project_name: payload.parentProjectName ?? null,
    contractor_role: payload.contractorRole ?? null,
    contractor_scope: payload.contractorScope ?? null,
    package_hint: payload.packageHint ?? null,
    crm_status: payload.crmStatus,
    enrichment_status: payload.enrichmentStatus,
    email_status: payload.emailStatus,
    target_roles: payload.targetRoles,
    notes: payload.notes,
    confidence: payload.confidence,
    requirement_summary: payload.requirementSummary,
    awarded_contractors: payload.awardedContractors ?? [],
    source_url: payload.sourceUrl,
    converted_at: payload.convertedAt,
  };
}
