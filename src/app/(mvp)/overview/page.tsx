import { redirect } from "next/navigation";

/** The Overview became the Dashboard (action plan + searches); old links keep working. */
export default function OverviewPage() {
  redirect("/dashboard");
}
