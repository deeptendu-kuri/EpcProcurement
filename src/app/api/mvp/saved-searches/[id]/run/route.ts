import { getSavedSearch } from "@/mvp/saved-searches";
import { savedSearchJob } from "@/mvp/scheduler";
import { jsonError, serverError, uuidSchema } from "../../../_shared/http";
import { enqueueResponse } from "../../../_shared/queue";

/** POST /api/mvp/saved-searches/[id]/run — "Run now", through the shared run queue → 202 ticket. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Saved search not found.");
  try {
    const search = await getSavedSearch(id);
    if (!search) return jsonError(404, "Saved search not found.");
    return await enqueueResponse(savedSearchJob(search));
  } catch (error) {
    return serverError("run saved search", error, "The search could not start. Try again in a moment.");
  }
}
