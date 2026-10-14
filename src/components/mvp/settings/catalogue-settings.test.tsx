import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CatalogueSettings } from "./catalogue-settings";
import { YourProducts } from "../dashboard/your-products";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/components/mvp/api-client", () => ({ apiJson: api }));
const initial = [{ id: "existing", name: "Pressure Vessels" }];
const show = () => render(<CatalogueSettings products={initial} reference={<p>Example ASME reference</p>} />);

beforeEach(() => { api.mockReset(); });
afterEach(cleanup);

describe("Editable Catalogue", () => {
  it("shows the saved products and add action before a collapsed read-only reference", () => {
    const { container } = show();
    expect(screen.getByRole("link", { name: "Pressure Vessels" }).getAttribute("href")).toBe("/find?q=Pressure%20Vessels");
    expect(screen.getByRole("button", { name: "Add product" })).toBeDefined();
    expect(container.querySelector("details")?.open).toBe(false);
    expect(screen.getByText(/does not change these standards/)).toBeDefined();
    expect(api).not.toHaveBeenCalled();
  });

  it("adds a product using the existing server API without starting research or email", async () => {
    api.mockResolvedValue({ product: { id: "new", name: "Example Shell and Tube Exchangers" } });
    show();
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Example Shell and Tube Exchangers" } });
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    await screen.findByRole("link", { name: "Example Shell and Tube Exchangers" });
    expect(api).toHaveBeenCalledExactlyOnceWith("/api/mvp/products", { method: "POST", body: { name: "Example Shell and Tube Exchangers" } });
    expect((screen.getByLabelText("Product name") as HTMLInputElement).value).toBe("");
  });

  it("removes only the selected product", async () => {
    api.mockResolvedValue({ ok: true });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Remove Pressure Vessels" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Pressure Vessels" })).toBeNull());
    expect(api).toHaveBeenCalledExactlyOnceWith("/api/mvp/products/existing", { method: "DELETE" });
  });

  it("keeps the product and shows an error when removal fails", async () => {
    api.mockRejectedValue(new Error("Please try again."));
    show();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove Pressure Vessels" })); });
    expect(screen.getByRole("alert").textContent).toBe("Please try again.");
    expect(screen.getByRole("link", { name: "Pressure Vessels" })).toBeDefined();
  });

  it("does not add a second chip when the API returns an existing product", async () => {
    api.mockResolvedValue({ product: initial[0] });
    show();
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Pressure Vessels" } });
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    await waitFor(() => expect((screen.getByLabelText("Product name") as HTMLInputElement).value).toBe(""));
    expect(screen.getAllByRole("link", { name: "Pressure Vessels" })).toHaveLength(1);
  });

  it("links Dashboard Manage directly to the editable Catalogue", () => {
    render(<YourProducts products={initial} />);
    expect(screen.getByRole("link", { name: "Manage" }).getAttribute("href")).toBe("/settings?tab=catalogue");
  });
});
