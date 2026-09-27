import { expect, it } from "vitest";
import { readWorkspaceView } from "./workspace-view";

it("restores view filters without restoring unrelated fields", () => {
  expect(readWorkspaceView('{"query":"Canada","regions":["Canada"],"selected":["old"]}', { query: "", regions: [] as string[] }))
    .toEqual({ query: "Canada", regions: ["Canada"] });
});
it("ignores malformed persisted filters", () => {
  expect(readWorkspaceView('{"query":null,"regions":42}', { query: "", regions: [] })).toEqual({ query: "", regions: [] });
});
