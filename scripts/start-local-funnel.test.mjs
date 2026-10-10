// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localFunnelEnv,researchDemoEnv } from "./start-local-funnel.mjs";

describe("local funnel startup isolation", () => {
  it('runs the same bounded discovery build with a demo worker only by explicit opt-in',()=>{
    expect(researchDemoEnv({DATABASE_URL:''})).toMatchObject({MVP_FUNNEL_WORKER:'off',MVP_NEXT_DIST_DIR:'.next-discovery'});
    expect(researchDemoEnv({DATABASE_URL:''},{demo:true})).toMatchObject({DATABASE_URL:'',MVP_FUNNEL_WORKER:'on',MVP_PROSPECT_DEMO_OUTREACH:'on',MVP_DEMO_PROSPECTS_PER_SEARCH:'3',MVP_MAX_SEARCH_QUERIES:'6',MVP_MAX_RESEARCH_AI_TOKENS:'30000'});
  });
  const root = path.resolve(".");
  const base = { SESSION_SECRET: "local-test-secret-".repeat(3) };
  it("overrides inherited cloud settings and preserves server-only provider keys", () => {
    const env = localFunnelEnv({ ...base, DATABASE_URL: "postgresql://cloud.invalid/db", MIGRATION_DATABASE_URL: "cloud",
      RENDER: "true", APP_URL: "https://cloud.invalid", MVP_DATA_DIR: "cloud-dir", MVP_OFFLINE: "1",
      DEMO_RECIPIENT_EMAIL: "other@example.com", MVP_OUTREACH_WORKER: "on", GROQ_API_KEY: "test-private", RESEND_API_KEY: "test-private" }, root);
    expect(env.DATABASE_URL).toBe(""); expect(env.MIGRATION_DATABASE_URL).toBe(""); expect(env.RENDER).toBe("");
    expect(env.APP_URL).toBe("http://localhost:3007"); expect(env.MVP_DATA_DIR).toBe(path.resolve(root, "tmp/automation-demo-db-20261003"));
    expect(env.DEMO_RECIPIENT_EMAIL).toBe("deeptendukuri@gmail.com"); expect(env.MVP_OFFLINE).toBe("0");
    expect(env.MVP_OUTREACH_WORKER).toBe("off"); expect(env.MVP_FUNNEL_WORKER).toBe("off");
    expect(env.GROQ_API_KEY).toBe("test-private"); expect(env.RESEND_API_KEY).toBe("test-private");
  });
  it("requires explicit worker activation and a stable session secret", () => {
    const env=localFunnelEnv({...base,APPROVED_DEMO_RECIPIENT_EMAIL:"new-demo@gmail.com",DEMO_RECIPIENT_EMAIL:"scraped@example.com"},root);
    expect(env.DEMO_RECIPIENT_EMAIL).toBe("new-demo@gmail.com");
    expect(localFunnelEnv({...base,SALES_PERSON_NAME:"Example Seller",SALES_COMPANY_NAME:"Example Supplies LLC"},root).DEMO_EMAIL_FROM).toBe("Example Seller · Example Supplies LLC <onboarding@resend.dev>");
    expect(localFunnelEnv({ ...base, MVP_FUNNEL_WORKER: "on" }, root).MVP_FUNNEL_WORKER).toBe("on");
    expect(() => localFunnelEnv({ ...base, MVP_FUNNEL_WORKER: "external" }, root)).toThrow("off or on");
    expect(() => localFunnelEnv({ SESSION_SECRET: "short" }, root)).toThrow("32 characters");
  });
});
