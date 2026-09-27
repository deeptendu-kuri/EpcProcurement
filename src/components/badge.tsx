import { clsx } from "clsx";

interface BadgeProps {
  children: React.ReactNode;
  tone?: "green" | "amber" | "red" | "neutral";
  title?: string;
}

export function Badge({ children, tone = "neutral", title }: BadgeProps) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex min-h-7 items-center rounded-md border px-2.5 py-1 text-xs font-semibold leading-4",
        tone === "green" && "border-emerald-600/20 bg-emerald-50 text-emerald-800",
        tone === "amber" && "border-amber-700/20 bg-amber-50 text-amber-900",
        tone === "red" && "border-red-700/20 bg-red-50 text-red-900",
        tone === "neutral" && "border-slate-200 bg-white text-slate-600",
      )}
    >
      {children}
    </span>
  );
}
