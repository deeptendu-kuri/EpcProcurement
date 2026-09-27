interface MetricProps {
  label: string;
  value: string | number;
  detail?: string;
}

export function Metric({ label, value, detail }: MetricProps) {
  return (
    <div className="surface rounded-lg p-4 transition-colors hover:border-[#cbd5e1] hover:bg-[#fbfcfe]">
      <div className="text-[11px] font-bold uppercase tracking-normal text-[#667085]">{label}</div>
      <div className="mt-2 text-2xl font-bold text-[#101828]">{value}</div>
      {detail ? <div className="mt-1 text-xs leading-5 text-[#667085]">{detail}</div> : null}
    </div>
  );
}
