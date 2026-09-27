import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ResponsiveTable } from "./responsive-table";

afterEach(cleanup);

it("preserves record controls and gives each stacked field its column label", () => {
  const { container, getByRole } = render(<ResponsiveTable className="min-w-[900px]">
    <thead><tr><th>Company</th><th>Status</th></tr></thead>
    <tbody>{["Acme"].map((name) => <tr key={name}><td>{name}</td><td><button>Review</button></td></tr>)}</tbody>
  </ResponsiveTable>);
  expect(Array.from(container.querySelectorAll("td")).map((cell) => cell.dataset.label)).toEqual(["Company", "Status"]);
  expect(container.querySelector("table")?.className).not.toContain("min-w-");
  expect(getByRole("button", { name: "Review" })).toBeTruthy();
});

it("does not mislabel a full-width empty state", () => {
  const { container } = render(<ResponsiveTable><thead><tr><th>Company</th></tr></thead><tbody><tr><td colSpan={3}>No results</td></tr></tbody></ResponsiveTable>);
  expect(container.querySelector("td")?.hasAttribute("data-label")).toBe(false);
});
