import type { SearchQueryConfig } from "@/types/providers";

export const pipelineSearchTaxonomy: SearchQueryConfig[] = [
  {
    id: "pipeline-epc-awards-gcc",
    name: "Pipeline EPC Awards - GCC",
    country: "GCC",
    product: "Line Pipe",
    keywordGroup: "EPC awards",
    sourceType: "news",
    language: "en",
    priority: 1,
    enabled: true,
    queries: [
      "pipeline EPC award gas pipeline contract",
      "gas transmission pipeline EPC award Saudi Arabia",
      "pipeline construction contract UAE API 5L",
    ],
  },
  {
    id: "line-pipe-tenders",
    name: "Line Pipe Tender Discovery",
    product: "API 5L Line Pipe",
    keywordGroup: "tenders",
    sourceType: "tender",
    language: "en",
    priority: 1,
    enabled: true,
    queries: [
      "API 5L tender line pipe",
      "LSAW pipe tender oil gas",
      "steel pipe procurement gas pipeline tender",
    ],
  },
  {
    id: "pipeline-project-announcements",
    name: "Pipeline Project Announcements",
    product: "Pipeline Materials",
    keywordGroup: "project announcements",
    sourceType: "project",
    language: "en",
    priority: 2,
    enabled: true,
    queries: [
      "new gas pipeline project announced",
      "oil pipeline project expansion EPC",
      "water pipeline project steel pipe procurement",
    ],
  },
];
