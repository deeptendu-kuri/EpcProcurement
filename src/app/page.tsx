import { redirect } from "next/navigation";

/** The root sends users to the Dashboard (the proxy has already required a session). */
export default function RootPage() {
  redirect("/dashboard");
}
