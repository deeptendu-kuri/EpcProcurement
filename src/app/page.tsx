import { redirect } from "next/navigation";

/** The root sends users to the Overview (the proxy has already required a session). */
export default function RootPage() {
  redirect("/overview");
}
