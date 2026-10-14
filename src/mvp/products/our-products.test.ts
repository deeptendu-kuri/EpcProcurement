// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import { addOurProduct, listOurProducts, otherProducts, removeOurProduct } from "./our-products";

describe("Our products (docs/mvp/22 §3.15)", () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 120_000);
  afterAll(async () => { await db.close(); });

  it("starts with the client's seven products", async () => {
    expect((await listOurProducts(db)).map((p) => p.name)).toEqual(["API 660 Heat Exchangers", "Axial Fans", "Blowers", "Centrifugal Fans", "Heat Exchangers", "Pressure Vessels", "Separators"]);
  });
  it("adds, keeps one entry for the same words, and removes", async () => {
    const added = await addOurProduct("  Shell and tube   heat exchangers ", db);
    expect(added.name).toBe("Shell and tube heat exchangers");
    const again = await addOurProduct("shell and tube heat exchangers", db);
    expect(again.id).toBe(added.id);
    expect((await listOurProducts(db)).filter((p) => p.id === added.id)).toEqual([{ id: added.id, name: "shell and tube heat exchangers" }]);
    expect(await removeOurProduct(added.id, db)).toBe(true);
    expect(await removeOurProduct(added.id, db)).toBe(false);
    await expect(addOurProduct("x", db)).rejects.toThrow("2 to 80 characters");
  });
  it("names his other products for an email, never the searched one", () => {
    const list = [{ id: "1", name: "Pressure Vessels" }, { id: "2", name: "Separators" }, { id: "3", name: "Blowers" }];
    expect(otherProducts(list, "pressure vessel")).toEqual(["Separators", "Blowers"]);
    expect(otherProducts(list, "Ball valves")).toEqual(["Pressure Vessels", "Separators", "Blowers"]);
  });
});
