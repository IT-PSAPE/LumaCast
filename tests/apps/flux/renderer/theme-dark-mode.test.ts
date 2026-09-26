import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// The shared theme paints light by default and only swaps its semantic tokens
// under `[data-theme="dark"]`. Flux is a dark-only surface, so the attribute has
// to be on the document element in the served HTML: the theme has to be active
// for the first paint, and the app never swaps it afterwards. This reads the
// served markup as a document and asserts what the DOM says, rather than
// matching the attribute's spelling in the source text.
const served = readFileSync(
  join(__dirname, "../../../../apps/flux/renderer/index.html"),
  "utf8",
);
const parsed = new DOMParser().parseFromString(served, "text/html");

test("the document element activates the shared dark theme before first paint", () => {
  const root = parsed.documentElement;
  expect(root.tagName).toBe("HTML");
  expect(root.dataset.theme).toBe("dark");
  // The attribute has to be on the root, not injected into the body later.
  expect(root.getAttribute("data-theme")).toBe("dark");
  expect(parsed.body?.dataset.theme).toBeUndefined();
});
