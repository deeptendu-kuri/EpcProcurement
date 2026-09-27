export function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "#2563eb" : score >= 45 ? "#c8922b" : "#b33b2e";

  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 42 42" className="h-14 w-14 -rotate-90">
        <circle cx="21" cy="21" r="17" fill="none" stroke="#e4e8e1" strokeWidth="4" />
        <circle
          cx="21"
          cy="21"
          r="17"
          fill="none"
          stroke={color}
          strokeDasharray={`${score} 100`}
          strokeLinecap="round"
          strokeWidth="4"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{score}</div>
    </div>
  );
}
