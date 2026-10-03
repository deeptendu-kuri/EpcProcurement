import { NextResponse } from "next/server";
import { z } from "zod";
import { createSavedSearch, listSavedSearches } from "@/mvp/saved-searches";
import { NO_STORE, readJson, serverError, uuidSchema } from "../_shared/http";
import { refreshSchema, runInputSchema } from "../_shared/schemas";

const createSchema = runInputSchema.extend({
  name: z.string().trim().min(1, "Give the search a name.").max(120),
  refreshHours: refreshSchema.default(6),
  lastRunId: uuidSchema.nullable().optional(),
});

/** GET /api/mvp/saved-searches — { savedSearches } newest first, with their last run. */
export async function GET() {
  try {
    return NextResponse.json({ savedSearches: await listSavedSearches() }, { headers: NO_STORE });
  } catch (error) {
    return serverError("list saved searches", error);
  }
}

/** POST /api/mvp/saved-searches — { name, query, markets[], leadKinds[], refreshHours: 6|12|24|null, lastRunId? } → 201. */
export async function POST(request: Request) {
  const body = await readJson(request, createSchema);
  if (body.response) return body.response;
  try {
    const savedSearch = await createSavedSearch({
      name: body.data.name,
      query: body.data.query,
      productId: body.data.productId,
      contactRole: body.data.contactRole,
      markets: body.data.markets,
      leadKinds: body.data.leadKinds,
      refreshHours: body.data.refreshHours,
      lastRunId: body.data.lastRunId ?? null,
    });
    return NextResponse.json({ savedSearch }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return serverError("create saved search", error, "The search could not be saved. Try again.");
  }
}
