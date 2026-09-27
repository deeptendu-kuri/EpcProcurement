import { describe, expect, it } from "vitest";
import { buildContactQueries, contactCandidate, extractTitle } from "./route";

describe("contractor contact search", () => {
  it("includes executive and leadership trails in contractor contact queries", () => {
    const queries = buildContactQueries({
      leadId: "lead-1",
      ownerCompany: "Saudi Aramco",
      parentProjectName: "Master Gas System 2",
      contractor: {
        name: "Perma-Pipe",
        packageHint: "Supply of line pipes",
        scope: "pipeline materials",
      },
      targetRoles: ["Procurement Manager", "Project Manager", "CEO / Managing Director"],
    }, "Perma-Pipe", ["Procurement Manager", "Project Manager", "CEO / Managing Director"]);

    expect(queries.join(" ")).toContain("CEO");
    expect(queries.join(" ")).toContain("Managing Director");
    expect(queries.join(" ")).toContain("management team");
    expect(queries.join(" ")).toContain("contact email phone procurement");
    expect(queries.length).toBeLessThanOrEqual(5);
  });

  it("extracts senior executive titles as valid decision-maker titles", () => {
    expect(extractTitle("Adham Sharkawy - CEO and Managing Director at Perma-Pipe", [])).toBe("CEO");
    expect(extractTitle("Jane Miller - Chief Executive Officer | Industrial Contractor", [])).toBe("Chief Executive Officer");
    expect(extractTitle("Omar Saleh - Managing Director, Gulf EPC Group", [])).toBe("Managing Director");
  });

  it("explains contact confidence with evidence signals", () => {
    const candidate = contactCandidate({
      leadId: "lead-1",
      companyName: "Perma-Pipe",
      contractorCountry: "Saudi Arabia",
      name: "Jane Miller",
      title: "Procurement Manager",
      linkedinUrl: "https://www.linkedin.com/in/jane-miller",
      email: "jane.miller@example.com",
      phone: "+971 50 123 4567",
      source: {
        url: "https://example.com/team",
        title: "Perma-Pipe leadership",
        text: "Jane Miller Procurement Manager jane.miller@example.com +971 50 123 4567",
        sourceType: "source page",
      },
    });

    expect(candidate.confidence).toBe(95);
    expect(candidate.confidenceBreakdown.professionalProfile).toBe(20);
    expect(candidate.confidenceBreakdown.directContact).toBe(15);
    expect(candidate.evidenceSignals).toEqual(expect.arrayContaining(["LinkedIn/profile evidence", "Email candidate found", "Phone candidate found", "Source page read"]));
    expect(candidate.emailStatus).toBe("Verification Pending");
  });
});
