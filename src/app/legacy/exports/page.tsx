import { Download } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export default function ExportsPage() {
  return (
    <ModulePage
      eyebrow="Exports"
      title="Export Center"
      description="Prepare verified leads, saved campaign lists, enriched contacts, and source evidence for controlled CSV export."
      icon={Download}
      primaryAction="Export CSV"
      metrics={[
        { label: "Export formats", value: "CSV", detail: "Current export path is CSV for client review and CRM import." },
        { label: "Lists supported", value: "3+", detail: "Priority buyers, procurement contacts, project owners, and custom lists." },
        { label: "Evidence included", value: "Yes", detail: "Project/source context remains attached to exported rows." },
      ]}
      rows={[
        { title: "Verified leads export", status: "Ready", detail: "Exports visible lead table rows with contact, company, source, intent topic, and CRM stage." },
        { title: "Lead-list export", status: "Ready", detail: "Exports contacts inside a selected list for campaign or CRM import." },
        { title: "Direct CRM sync", status: "Requires CRM target", detail: "CRM push can be enabled after the destination system and field mapping are confirmed." },
      ]}
    />
  );
}
