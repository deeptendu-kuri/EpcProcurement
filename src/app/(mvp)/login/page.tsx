import { AlertTriangle, Building2, LockKeyhole } from "lucide-react";
import { authConfigError, safeNextPath } from "@/mvp/auth/session";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const error = typeof params.error === "string" ? params.error : null;
  const configError = authConfigError();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] px-4">
      <div className="surface w-full max-w-sm rounded-xl p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2563eb] text-white">
            <Building2 size={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-[#101828]">Industrial Buyer Intelligence</h1>
            <p className="text-sm text-[#667085]">Sign in to continue</p>
          </div>
        </div>

        {configError ? (
          <div role="alert" className="mt-5 flex gap-2 rounded-md border border-[#fecdca] bg-[#fef3f2] p-3 text-sm text-[#b42318]">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Sign-in is not configured</p>
              <p className="mt-1">{configError}</p>
            </div>
          </div>
        ) : null}

        {!configError && error ? (
          <div role="alert" className="mt-5 rounded-md border border-[#fecdca] bg-[#fef3f2] p-3 text-sm font-semibold text-[#b42318]">
            {error === "invalid" ? "Wrong password. Try again." : "Sign-in failed. Try again."}
          </div>
        ) : null}

        <form method="post" action="/api/mvp/login" className="mt-5 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password" className="text-sm font-semibold text-[#344054]">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            disabled={Boolean(configError)}
            className="focus-ring h-10 rounded-md border border-[#d0d5dd] bg-white px-3 text-sm text-[#101828] disabled:bg-[#f2f4f7]"
          />
          <button
            type="submit"
            disabled={Boolean(configError)}
            className="btn-primary focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold disabled:opacity-50"
          >
            <LockKeyhole size={16} />
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
