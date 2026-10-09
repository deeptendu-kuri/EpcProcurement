import { describe, expect, it, vi } from "vitest";
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
import OverviewPage from "./page";

describe("Overview became the Dashboard", () => {
  it("sends old Overview links to the Dashboard", () => {
    OverviewPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });
});
