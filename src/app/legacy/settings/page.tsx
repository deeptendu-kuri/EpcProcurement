import { Settings } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export default function SettingsPage() {
  return (
    <ModulePage
      eyebrow="Workspace Settings"
      title="Client-Safe Configuration"
      description="A presentation-safe control area for data policies, verification rules, source preferences, and workspace behavior."
      icon={Settings}
      primaryAction="Save Policy"
      metrics={[
        { label: "Provider names", value: "Hidden", detail: "Internal vendor names are not exposed in the frontend." },
        { label: "Data policy", value: "Verified-first", detail: "Unverified contact data stays out of client-ready tables." },
        { label: "Workspace mode", value: "Client-safe", detail: "Provider details and unverified claims stay hidden in presentation views." },
      ]}
      rows={[
        { title: "Verified-only client mode", status: "Ready", detail: "Client-facing views can hide weak, duplicate, or unverified lead rows." },
        { title: "Intent-data source", status: "Requires data source", detail: "Exact private search-keyword intelligence requires a paid intent-data subscription." },
      ]}
    />
  );
}
