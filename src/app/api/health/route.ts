import { NextResponse } from "next/server";
import { hasServerSupabaseConfig, runtimeConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const database = createSupabaseServiceClient();
  let databaseConnected = false;

  if (database) {
    const { error } = await database.from("saved_discovery_searches").select("id").limit(1);
    databaseConnected = !error;
  }

  return NextResponse.json({
    ok: true,
    databaseConfigured: hasServerSupabaseConfig(),
    databaseConnected,
    liveDiscoveryConfigured: Boolean(runtimeConfig.searchProviderKey && runtimeConfig.contentProviderKey),
  });
}
