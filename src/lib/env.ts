import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  NEXT_PUBLIC_DATABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_DATABASE_PUBLIC_KEY: z.string().optional(),
  DATABASE_SERVICE_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  SEARCH_PROVIDER_API_KEY: z.string().optional(),
  CONTENT_PROVIDER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  VOLZA_API_KEY: z.string().optional(),
  TRADE_DATA_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const runtimeConfig = {
  databaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_DATABASE_URL,
  databasePublicKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_DATABASE_PUBLIC_KEY,
  databaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || env.DATABASE_SERVICE_KEY,
  searchProviderKey: env.SERPAPI_API_KEY || env.SEARCH_PROVIDER_API_KEY,
  contentProviderKey: env.FIRECRAWL_API_KEY || env.CONTENT_PROVIDER_API_KEY,
  tradeDataKey: env.VOLZA_API_KEY || env.TRADE_DATA_API_KEY,
};

export function hasSupabaseConfig() {
  return Boolean(runtimeConfig.databaseUrl && runtimeConfig.databasePublicKey);
}

export function hasServerSupabaseConfig() {
  return hasSupabaseConfig() && Boolean(runtimeConfig.databaseServiceKey);
}
