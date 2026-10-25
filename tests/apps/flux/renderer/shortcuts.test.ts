import { describe, expect, it } from "vitest";
import {
  primaryShortcutLabel,
  resolveShortcut,
  type ShortcutEvent,
} from "../../../../apps/flux/renderer/shortcuts";

function press(key: string, init: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: document.body,
    ...init,
  };
}

function focused(tag: string, attrs: Record<string, string> = {}) {
  const element = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) element.setAttribute(k, v);
  document.body.append(element);
  return element;
}

describe("resolveShortcut", () => {
  it("maps bare keys to commands", () => {
    expect(resolveShortcut(press("g"), "editor")).toBe("library");
    expect(resolveShortcut(press("E"), "gallery")).toBe("edit");
    expect(resolveShortcut(press("j"), "editor")).toBe("toggle-clipping");
    expect(resolveShortcut(press("j"), "gallery")).toBeNull();
    expect(resolveShortcut(press("f"), "gallery")).toBe("favorite");
    expect(resolveShortcut(press("ArrowRight"), "gallery")).toBe("next");
    expect(resolveShortcut(press("ArrowLeft"), "gallery")).toBe("previous");
    expect(resolveShortcut(press("Escape"), "editor")).toBe("library");
  });

  it("maps 0-5 to ratings in both views and ignores 6-9", () => {
    for (const view of ["gallery", "editor"] as const) {
      for (const n of [0, 1, 2, 3, 4, 5]) {
        expect(resolveShortcut(press(String(n)), view)).toBe(`rate-${n}`);
      }
      expect(resolveShortcut(press("6"), view)).toBeNull();
    }
  });

  it("keeps Cmd/Ctrl+A as select all", () => {
    expect(resolveShortcut(press("a", { metaKey: true }), "gallery")).toBe("select-all");
    expect(resolveShortcut(press("a", { ctrlKey: true }), "gallery")).toBe("select-all");
    expect(resolveShortcut(press("a"), "gallery")).toBeNull();
  });

  it.each(["metaKey", "ctrlKey", "altKey", "shiftKey"] as const)(
    "does not fire letter, digit or rating keys with %s",
    (modifier) => {
      for (const key of ["e", "g", "j", "f", "0", "3", "5"]) {
        expect(resolveShortcut(press(key, { [modifier]: true }), "editor")).toBeNull();
      }
    },
  );

  it("does not fire Cmd+E, Cmd+G, Cmd+J or Ctrl+G", () => {
    expect(resolveShortcut(press("e", { metaKey: true }), "gallery")).toBeNull();
    expect(resolveShortcut(press("g", { metaKey: true }), "gallery")).toBeNull();
    expect(resolveShortcut(press("j", { metaKey: true }), "editor")).toBeNull();
    expect(resolveShortcut(press("g", { ctrlKey: true }), "gallery")).toBeNull();
  });

  it("does not fire arrows or Escape with Cmd/Ctrl/Alt", () => {
    expect(resolveShortcut(press("ArrowRight", { metaKey: true }), "gallery")).toBeNull();
    expect(resolveShortcut(press("ArrowLeft", { altKey: true }), "gallery")).toBeNull();
    expect(resolveShortcut(press("Escape", { ctrlKey: true }), "editor")).toBeNull();
  });

  it("does not repeat toggles while a key is held", () => {
    expect(resolveShortcut(press("f", { repeat: true }), "gallery")).toBeNull();
    expect(resolveShortcut(press("3", { repeat: true }), "gallery")).toBeNull();
  });

  it("does not fire while a text field, select, slider or dialog has focus", () => {
    const targets = [
      focused("input", { type: "search" }),
      focused("input"),
      focused("textarea"),
      focused("select"),
      focused("div", { role: "slider" }),
      focused("div", { role: "combobox" }),
      focused("div", { contenteditable: "true" }),
    ];
    const dialog = focused("div", { role: "dialog" });
    const inner = document.createElement("button");
    dialog.append(inner);
    targets.push(inner);
    for (const target of targets) {
      for (const key of ["e", "g", "j", "f", "1", "0", "ArrowRight", "Escape"]) {
        expect(resolveShortcut(press(key, { target }), "editor")).toBeNull();
      }
      expect(resolveShortcut(press("a", { metaKey: true, target }), "gallery")).toBeNull();
    }
  });

  it("still fires from a focused button", () => {
    const button = focused("button");
    expect(resolveShortcut(press("4", { target: button }), "gallery")).toBe("rate-4");
  });
});

describe("primaryShortcutLabel", () => {
  it("uses glyphs on macOS and Ctrl+ elsewhere", () => {
    expect(primaryShortcutLabel("darwin", "Z")).toBe("⌘Z");
    expect(primaryShortcutLabel("darwin", "Z", true)).toBe("⇧⌘Z");
    expect(primaryShortcutLabel("win32", "Z")).toBe("Ctrl+Z");
    expect(primaryShortcutLabel("linux", "Z", true)).toBe("Ctrl+Shift+Z");
    expect(primaryShortcutLabel(undefined, "Z")).toBe("Ctrl+Z");
  });
});
