import { Building2 } from "lucide-react";
import { Badge } from "@/components/badge";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f8fafc] p-4">
      <section className="w-full max-w-md border border-[#d0d5dd] bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center bg-[#2563eb] text-white">
            <Building2 size={21} />
          </div>
          <div>
            <h1 className="text-xl font-bold">Industrial Buyer Intelligence</h1>
            <p className="text-sm text-[#667085]">Secure access ready</p>
          </div>
        </div>
        <div className="mt-6">
          <Badge tone="amber">Auth wiring pending credentials</Badge>
          <p className="mt-4 text-sm leading-6 text-[#667085]">
            Add production authentication credentials to enable real login. The protected app shell and role model are ready for secure access control.
          </p>
        </div>
      </section>
    </main>
  );
}
