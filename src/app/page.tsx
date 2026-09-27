import { redirect } from "next/navigation";

/** The root sends users to Find (the proxy has already required a session). */
export default function RootPage() {
  redirect("/find");
}
