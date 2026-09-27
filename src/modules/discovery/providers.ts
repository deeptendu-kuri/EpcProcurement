import { runtimeConfig } from "@/lib/env";
import { domainFromUrl } from "@/lib/urls";
import type { SearchProvider, SearchQueryConfig, SearchResult } from "@/types/providers";

export class SerpApiProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(config: SearchQueryConfig): Promise<SearchResult[]> {
    const results = await Promise.allSettled(config.queries.map((query) => this.searchQuery(config, query)));
    const fulfilled = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));

    if (fulfilled.length === 0 && errors.length > 0) {
      throw new Error(`Search provider could not return results for any query: ${Array.from(new Set(errors)).join(" | ")}`);
    }

    return fulfilled;
  }

  private async searchQuery(config: SearchQueryConfig, query: string): Promise<SearchResult[]> {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("hl", config.language);

    const response = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(60_000) }).catch((error: unknown) => {
      throw new Error(`Search provider network request failed for "${query}": ${networkErrorMessage(error)}`);
    });
    if (!response.ok) {
      throw new Error(`SerpApi request failed with ${response.status} for "${query}"`);
    }

    const data = (await response.json()) as {
      organic_results?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
    };

    return (data.organic_results ?? [])
      .filter((result) => result.link)
      .map((result) => ({
        query,
        title: result.title ?? "Untitled result",
        url: result.link!,
        snippet: result.snippet ?? "",
        sourceDomain: domainFromUrl(result.link!),
        publishedAt: result.date,
      }));
  }
}

export function createSearchProvider(): SearchProvider {
  if (!runtimeConfig.searchProviderKey) {
    throw new Error("Search provider key is required for discovery");
  }

  return new SerpApiProvider(runtimeConfig.searchProviderKey);
}

function networkErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? ` (${cause.message})` : "";
    return `${error.message}${causeMessage}`;
  }

  return "Unknown network error";
}
