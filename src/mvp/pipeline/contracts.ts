/**
 * Internal contracts between pipeline stages (05 §3 reader contract, adapted to TypeScript).
 */
import type { ClientProfile, RunInput, SourceTier } from "@/mvp/types";
import type { P1Output, P2Output, P3Output } from "./schemas";
import type { Db } from "@/mvp/db";

/** Facts a structured source already gives (e.g. TED winners and values). Quotes must be substrings of `text`. */
export interface StructuredFacts {
  /** e.g. "rule:ted" */
  extractedBy: string;
  p1: P1Output;
  p2: P2Output;
  p3?: P3Output;
}

/** One item discovered by a source (05 §3 DiscoveredItem + FetchedDocument). */
export interface RawDoc {
  /** 'ted' | 'gdelt' | 'rss:<host>' | 'fixture' */
  sourceKey: string;
  sourceName: string;
  tier: SourceTier;
  /** Defaults to the URL's domain group. */
  publisherKey?: string;
  url: string;
  title: string | null;
  publishedAt: string | null;
  /** Full text when the source already has it (fixtures, TED, long RSS descriptions); null = fetch in the read step. */
  text: string | null;
  /** Used when the page cannot be fetched (e.g. RSS description). */
  fallbackText?: string | null;
  /** Market the source is specific to (fixtures, TED buyer country). */
  market?: string | null;
  language?: string | null;
  isSample: boolean;
  structured?: StructuredFacts;
  /** Research routing only; hints never establish company/product facts. */
  research?: {
    lane: "company" | "project" | "activity" | "directory" | "investigation" | "news";
    registryId?: string;
    candidateId?: string;
    /** Provider preview, used only to prioritise reading. Never source/evidence text. */
    searchPreview?: string;
  };
}

export interface SourceContext {
  /** Explicit persistence for successful query caching; no hidden database fallback in adapters. */
  db?: Db;
  runId: string;
  input: RunInput;
  profile: ClientProfile;
  /** Scope terms from the run query (filter.queryTerms). */
  terms: string[];
  /** Write an info event to the run. */
  log: (message: string) => Promise<void>;
}

export interface Source {
  key: string;
  name: string;
  collect(ctx: SourceContext): Promise<RawDoc[]>;
}
