import { describe, expect, it } from "vitest";
import { addToast, dismissToast, type Toast, toastAutoDismissMs } from "./toasts";

describe("toast queue reducer", () => {
  it("appends a toast carrying the given id, kind and message", () => {
    const next = addToast([], { kind: "error", message: "boom" }, "t1");
    expect(next).toEqual<Toast[]>([{ id: "t1", kind: "error", message: "boom" }]);
  });

  it("keeps existing toasts and appends in order", () => {
    const one = addToast([], { kind: "success", message: "done" }, "t1");
    const two = addToast(one, { kind: "error", message: "boom" }, "t2");
    expect(two.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(one).toHaveLength(1); // does not mutate the input
  });

  it("removes a toast by id", () => {
    const state: Toast[] = [
      { id: "t1", kind: "error", message: "a" },
      { id: "t2", kind: "success", message: "b" },
    ];
    expect(dismissToast(state, "t1")).toEqual([{ id: "t2", kind: "success", message: "b" }]);
  });

  it("dismissing an unknown id leaves the queue unchanged", () => {
    const state: Toast[] = [{ id: "t1", kind: "error", message: "a" }];
    expect(dismissToast(state, "nope")).toEqual(state);
  });
});

describe("toastAutoDismissMs", () => {
  it("returns null for error toasts so they persist until dismissed", () => {
    expect(toastAutoDismissMs("error")).toBeNull();
  });

  it("returns a finite delay for success toasts", () => {
    expect(toastAutoDismissMs("success")).toBe(4000);
  });
});
