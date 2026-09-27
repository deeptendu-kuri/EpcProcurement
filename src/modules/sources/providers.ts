import { sha256 } from "@/lib/hash";
import { runtimeConfig } from "@/lib/env";
import type { ContentExtractor, ExtractedContent } from "@/types/providers";

export class FirecrawlExtractor implements ContentExtractor {
  constructor(private readonly apiKey: string) {}

  async extract(url: string): Promise<ExtractedContent> {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      signal: AbortSignal.timeout(18_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 15000,
      }),
    }).catch((error: unknown) => {
      throw new Error(`Content provider network request failed: ${networkErrorMessage(error)}`);
    });

    if (!response.ok) {
      throw new Error(`Firecrawl request failed with ${response.status}`);
    }

    const data = (await response.json()) as { data?: { markdown?: string; metadata?: { title?: string } } };
    const markdown = data.data?.markdown ?? "";
    if (!markdown.trim()) {
      throw new Error("Firecrawl returned empty content");
    }

    return {
      url,
      title: data.data?.metadata?.title,
      markdown,
      contentHash: sha256(markdown),
      scrapedAt: new Date().toISOString(),
    };
  }
}

export function createContentExtractor(): ContentExtractor {
  if (!runtimeConfig.contentProviderKey) {
    throw new Error("Content provider key is required for content extraction");
  }

  return new FirecrawlExtractor(runtimeConfig.contentProviderKey);
}

function networkErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? ` (${cause.message})` : "";
    return `${error.message}${causeMessage}`;
  }

  return "Unknown network error";
}
