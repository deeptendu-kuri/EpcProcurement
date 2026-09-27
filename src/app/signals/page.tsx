import { Radio } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export default function SignalsPage() {
  return (
    <ModulePage
      eyebrow="Buying Signals"
      title="Signal Intelligence"
      description="Review public project, procurement, hiring, tender, award, and activity signals before they become lead records."
      icon={Radio}
      primaryAction="Create Signal Rule"
      metrics={[
        { label: "Signal types", value: "7", detail: "Project, tender, award, hiring, supplier, material, and account activity signals." },
        { label: "Review queue", value: "Pending", detail: "Live queue counts appear here once source monitoring is connected." },
        { label: "Topic coverage", value: "Public", detail: "Source-backed topics, not private browsing histories." },
      ]}
      rows={[
        { title: "Public intent topic tracking", status: "Ready", detail: "Shows matched topics such as pipeline EPC, LNG procurement, and water transmission tender." },
        { title: "Licensed intent topics", status: "Requires data source", detail: "Licensed company-level topics can be added without claiming exact private search queries." },
        { title: "Source-quality scoring", status: "Ready", detail: "Prioritizes company announcements, tender portals, government procurement pages, and EPC news." },
      ]}
    />
  );
}
