// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "./origin";
afterEach(() => vi.unstubAllEnvs());
describe("cloud public origin", () => {
  it("uses APP_URL instead of the internal proxy origin", () => {
    vi.stubEnv("APP_URL", "https://buyer-demo.onrender.com");
    expect(publicOrigin("http://localhost:10000/api/mvp/login")).toBe("https://buyer-demo.onrender.com");
  });
  it("keeps local development working without APP_URL", () => {
    vi.stubEnv("APP_URL", "");
    expect(publicOrigin("http://localhost:3001/login")).toBe("http://localhost:3001");
  });
  it("refuses invalid public origins", () => {
    for (const value of ["ftp://host", "https://user:password@host", "https://host/path", "https://host?q=x"]) {
      vi.stubEnv("APP_URL", value); expect(() => publicOrigin("http://localhost")).toThrow();
    }
  });
});
