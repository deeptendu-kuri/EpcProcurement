import { getActiveProducts, getClientProfile } from "@/mvp/config/profile";
import { serverError } from "../_shared/http";
import { enqueueResponse } from "../_shared/queue";

/**
 * POST /api/mvp/sample — "Load sample leads" (docs/mvp/13 U8): runs the pipeline over the offline sample
 * documents (every lead gets the "Sample data" badge), through the shared run queue → 202 ticket.
 */
export async function POST() {
  try {
    const profile = getClientProfile();
    const words = [...new Set(getActiveProducts().map((product) => product.keywords[0] ?? product.name))].slice(0, 6);
    return await enqueueResponse({
      sample: true,
      input: { query: words.join(", ") || "line pipe", markets: [...profile.markets], leadKinds: ["bid", "supply_subcontract"] },
    });
  } catch (error) {
    return serverError("load sample leads", error, "Sample leads could not be loaded. Try again.");
  }
}
