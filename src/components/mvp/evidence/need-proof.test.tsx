import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { NeedCard } from "@/mvp/buyers/types";
import { NeedProof } from "./need-proof";
import { buyingWindow } from "@/mvp/evidence/need-card";

afterEach(cleanup);
const need: NeedCard = {
  item: "Cryogenic valves", work: "Tecnimont will deliver a new NGL fractionation train at Ruwais.", why: "NGL fractionation runs below −90 °C; its cold sections need cryogenic valves.",
  use: "NGL fractionation plant", project: "Ruwais NGL train 5", date: "2026-08", window: "buying now", role: "EPC contractor", country: "United Arab Emirates",
  url: "https://www.example.com/news/ruwais", source: "example.com", competitor: "AMPO: supply of 600+ cryogenic ball valves",
  checks: ["Sentence found in the source", "Date of the work read from the source", "Work is in your countries"], more: 2,
};

describe("Why they are a buyer (docs/mvp/20 §8)", () => {
  it("shows the proof as bullet points: work, why, window, role, signal, checks", () => {
    render(<NeedProof need={need} />);
    const card = screen.getByTestId("need-proof");
    expect(within(card).getByRole("heading").textContent).toBe("Why they are a buyer of Cryogenic valves");
    const items = within(card).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toBe("Their work: “Tecnimont will deliver a new NGL fractionation train at Ruwais.” — example.com (2026-08)");
    expect(items[1]).toBe("Why it needs Cryogenic valves: NGL fractionation runs below −90 °C; its cold sections need cryogenic valves.");
    expect(items[2]).toBe("Buying window: buying now");
    expect(items[3]).toBe("Role: EPC contractor · United Arab Emirates · Project: Ruwais NGL train 5");
    expect(items).toContain("Strongest signal: a supplier of this item is named on the same work — AMPO: supply of 600+ cryogenic ball valves");
    expect(items).toContain("Checked: ✓ Sentence found in the source · ✓ Date of the work read from the source · ✓ Work is in your countries");
    expect(items.at(-1)).toBe("2 more sources show the same.");
    expect(within(card).getByRole("link", { name: "example.com" }).getAttribute("href")).toBe("https://www.example.com/news/ruwais");
  });
  it("says plainly when the source gives no date", () => {
    render(<NeedProof need={{ ...need, date: null, window: "check date", competitor: null, more: 0 }} />);
    expect(screen.getByText(/the source gives no date for this work/)).toBeTruthy();
    expect(screen.queryByText(/Strongest signal/)).toBeNull();
  });
  it("puts work won in the last 6 months as buying now, up to 18 as buying soon, up to 30 as still building", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect([buyingWindow("2026-08", now), buyingWindow("2026-01-20", now), buyingWindow("2025-02-07", now), buyingWindow(null, now)])
      .toEqual(["buying now", "buying soon", "still building", "check date"]);
  });
});
