import { DatabaseZap } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export default function EnrichmentPage() {
  return (
    <ModulePage
      eyebrow="Contact Enrichment"
      title="Decision-Maker Enrichment"
      description="Manage role targeting, source-backed contact discovery, and email verification review without exposing provider details."
      icon={DatabaseZap}
      primaryAction="Queue Enrichment"
      metrics={[
        { label: "Target roles", value: "5", detail: "Procurement, project, supply chain, engineering, and executive targets." },
        { label: "Email states", value: "5", detail: "Email not found, search queued, verification pending, verified, and risky." },
        { label: "Verified policy", value: "On", detail: "No fake emails are generated. Unknown remains unknown until verified." },
      ]}
      rows={[
        { title: "Decision-maker search", status: "Ready", detail: "Converted company/project leads can request role-based contact research." },
        { title: "Waterfall verification", status: "Requires data source", detail: "Multi-step verification activates when a production contact-data source is connected." },
        { title: "LinkedIn and source evidence", status: "Ready", detail: "Known LinkedIn/source links are displayed, and missing links stay marked as not found." },
      ]}
    />
  );
}
