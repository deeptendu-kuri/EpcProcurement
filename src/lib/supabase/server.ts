import { createClient } from "@supabase/supabase-js";
import { hasServerSupabaseConfig, hasSupabaseConfig, runtimeConfig } from "@/lib/env";

export function createSupabaseBrowserClient() {
  if (!hasSupabaseConfig()) {
    return null;
  }

  return createClient(runtimeConfig.databaseUrl!, runtimeConfig.databasePublicKey!);
}

export function createSupabaseServiceClient() {
  if (!hasServerSupabaseConfig()) {
    return null;
  }

  return createClient(runtimeConfig.databaseUrl!, runtimeConfig.databaseServiceKey!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
