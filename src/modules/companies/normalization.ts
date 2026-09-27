const suffixes = [
  "llc",
  "l.l.c",
  "ltd",
  "limited",
  "inc",
  "corp",
  "corporation",
  "company",
  "co",
  "psc",
  "pjsc",
  "sa",
];

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bl\.?\s*l\.?\s*c\.?\b/g, " llc ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((part) => part && !suffixes.includes(part))
    .join(" ")
    .trim();
}

export function companyNameSimilarity(a: string, b: string): number {
  const left = new Set(normalizeCompanyName(a).split(" "));
  const right = new Set(normalizeCompanyName(b).split(" "));
  const intersection = [...left].filter((part) => right.has(part)).length;
  const union = new Set([...left, ...right]).size;

  return union === 0 ? 0 : intersection / union;
}
