import Link from "next/link";
import { ArrowLeft, ExternalLink, LinkIcon, Mail, UserCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { ScoreRing } from "@/components/score-ring";
import { getBuyerOpportunity } from "@/modules/dashboard/repository";

interface PageProps {
  params: Promise<{ id: string }>;
}

function tradeStatusLabel(status: string) {
  return status === "Not Connected" ? "Trade Check Pending" : status;
}

function emailTone(status: string) {
  if (status === "Verified") return "green";
  if (status === "Risky") return "amber";
  if (status === "Not Found") return "red";
  return "neutral";
}

export default async function CompanyPage({ params }: PageProps) {
  const { id } = await params;
  const opportunity = await getBuyerOpportunity(id);

  if (!opportunity) {
    notFound();
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <Link href="/legacy" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#2563eb]">
          <ArrowLeft size={16} />
          Dashboard
        </Link>

        <header className="border border-[#d0d5dd] bg-white p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <h1 className="text-3xl font-bold">{opportunity.company.canonicalName}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">{opportunity.company.description}</p>
            </div>
            <div className="flex items-center gap-4">
              <ScoreRing score={opportunity.score.score} />
              <div>
                <div className="text-xs uppercase text-[#667085]">Confidence</div>
                <div className="mt-1"><Badge tone={opportunity.score.confidence === "High" ? "green" : "amber"}>{opportunity.score.confidence}</Badge></div>
              </div>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="border border-[#d0d5dd] bg-[#f8fafc] p-3">
              <dt className="text-xs uppercase text-[#667085]">Country</dt>
              <dd className="mt-1 font-bold">{opportunity.company.country}</dd>
            </div>
            <div className="border border-[#d0d5dd] bg-[#f8fafc] p-3">
              <dt className="text-xs uppercase text-[#667085]">Industry</dt>
              <dd className="mt-1 font-bold">{opportunity.company.industry}</dd>
            </div>
            <div className="border border-[#d0d5dd] bg-[#f8fafc] p-3">
              <dt className="text-xs uppercase text-[#667085]">Requirement</dt>
              <dd className="mt-1 font-bold">{opportunity.potentialProduct}</dd>
            </div>
            <div className="border border-[#d0d5dd] bg-[#f8fafc] p-3">
              <dt className="text-xs uppercase text-[#667085]">Trade Intelligence</dt>
              <dd className="mt-1 font-bold">{tradeStatusLabel(opportunity.tradeVerification)}</dd>
            </div>
          </dl>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <section className="border border-[#d0d5dd] bg-white p-5">
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <h2 className="text-lg font-bold">Decision Makers</h2>
                  <p className="mt-1 text-sm text-[#667085]">Contact targets attached to this verified buyer account.</p>
                </div>
                <Badge tone="neutral">Email enrichment pending</Badge>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2">Department</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">LinkedIn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(opportunity.decisionMakers ?? []).map((contact) => (
                      <tr key={contact.id} className="border-t border-[#e4e7ec] align-top">
                        <td className="px-3 py-3">
                          <div className="flex items-start gap-2">
                            <UserCheck size={16} className="mt-0.5 text-[#2563eb]" />
                            <div>
                              <div className="font-bold">{contact.name}</div>
                              <div className="mt-1 text-xs text-[#667085]">{contact.location}</div>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[230px] px-3 py-3">{contact.title}</td>
                        <td className="px-3 py-3">{contact.department} / {contact.seniority}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <Mail size={15} className="text-[#667085]" />
                            <Badge tone={emailTone(contact.emailStatus)}>{contact.emailStatus}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-[#667085]">{contact.email ?? "Enrichment pending"}</div>
                        </td>
                        <td className="px-3 py-3">
                          {contact.linkedinUrl ? (
                            <a className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#d0d5dd] bg-white text-[#0b66c3] hover:bg-[#f8fafc]" href={contact.linkedinUrl} title="Open LinkedIn">
                              <LinkIcon size={16} />
                            </a>
                          ) : (
                            <span className="text-xs text-[#667085]">Not found</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Why This Buyer?</h2>
              <div className="mt-4 space-y-3">
                {opportunity.score.reasons.map((reason) => (
                  <div key={reason.label} className="flex gap-3 border border-[#e4e7ec] p-3">
                    <div className="flex h-8 w-12 shrink-0 items-center justify-center bg-[#2563eb] text-sm font-bold text-white">+{reason.points}</div>
                    <div>
                      <div className="font-semibold">{reason.label}</div>
                      <div className="mt-1 text-xs text-[#667085]">Evidence IDs: {reason.evidenceIds.join(", ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Signal Timeline</h2>
              <div className="mt-4 space-y-3">
                {[opportunity.latestSignal].map((signal) => (
                  <div key={signal.id} className="grid gap-2 border-l-4 border-[#c8922b] bg-[#f8fafc] p-3 md:grid-cols-[120px_1fr]">
                    <div className="text-sm font-bold">{signal.signalDate}</div>
                    <div>
                      <div className="font-semibold">{signal.signalType.replaceAll("_", " ")}</div>
                      <p className="mt-1 text-sm leading-6 text-[#667085]">{signal.summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Product Requirements</h2>
              {opportunity.requirements.length === 0 ? (
                <div className="mt-4 border border-[#e4e7ec] bg-[#f8fafc] p-4 text-sm leading-6 text-[#667085]">
                  No exact product specification was detected in the verified source. Keep this lead in research until tender documents or material package details are found.
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-sm">
                    <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                      <tr>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Standard</th>
                        <th className="px-3 py-2">Grade</th>
                        <th className="px-3 py-2">Quantity</th>
                        <th className="px-3 py-2">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opportunity.requirements.map((requirement) => (
                        <tr key={requirement.id} className="border-t border-[#e4e7ec]">
                          <td className="px-3 py-3">{requirement.productCategory}</td>
                          <td className="px-3 py-3">{requirement.productType ?? "-"}</td>
                          <td className="px-3 py-3">{requirement.standard ?? "-"}</td>
                          <td className="px-3 py-3">{requirement.grade ?? "-"}</td>
                          <td className="px-3 py-3">{requirement.quantity ? `${requirement.quantity} ${requirement.unit ?? ""}` : "-"}</td>
                          <td className="px-3 py-3">{Math.round(requirement.confidence * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Intent Match</h2>
              <div className="mt-3 rounded-md border border-[#e4e7ec] bg-[#f8fafc] p-3">
                <div className="text-xs font-bold uppercase text-[#667085]">Matched query</div>
                <div className="mt-1 font-semibold">{opportunity.matchedQuery ?? "Matched source signal"}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(opportunity.intentKeywords ?? []).map((keyword) => (
                  <span key={keyword} className="rounded-md border border-[#d0d5dd] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#475467]">
                    {keyword}
                  </span>
                ))}
              </div>
            </section>

            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Recommended Action</h2>
              <p className="mt-3 text-sm leading-6 text-[#667085]">{opportunity.recommendedAction}</p>
            </section>

            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Trade Data</h2>
              <div className="mt-3">
                <Badge tone="amber" title="Trade-history verification is pending for this account.">
                  {tradeStatusLabel(opportunity.tradeVerification)}
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#667085]">
                Import/export history has not been checked yet for this account.
              </p>
            </section>

            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Project</h2>
              <p className="mt-3 font-semibold">{opportunity.project?.name ?? "No project linked"}</p>
              <p className="mt-2 text-sm leading-6 text-[#667085]">{opportunity.project?.description}</p>
            </section>

            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Tender</h2>
              <p className="mt-3 font-semibold">{opportunity.tender?.title ?? "No tender detected"}</p>
              <p className="mt-2 text-sm leading-6 text-[#667085]">{opportunity.tender?.description}</p>
            </section>

            <section className="border border-[#d0d5dd] bg-white p-5">
              <h2 className="text-lg font-bold">Sources</h2>
              <div className="mt-4 space-y-3">
                {opportunity.sources.map((source) => (
                  <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="block border border-[#e4e7ec] p-3 hover:border-[#2563eb]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold">{source.title}</div>
                      <ExternalLink size={15} className="shrink-0 text-[#667085]" />
                    </div>
                    <div className="mt-2 text-xs text-[#667085]">{source.domain} / {source.reliability}</div>
                  </a>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
