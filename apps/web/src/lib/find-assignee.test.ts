import { describe, expect, it } from "vitest";
import { findAssignee } from "./find-assignee";

const members = [
  { userId: "u1", user: { name: "Alice", image: "alice.png" } },
  { userId: "u2", user: { name: "Bob", image: null } },
];

describe("findAssignee", () => {
  it("returns the project member", () => {
    expect(findAssignee(members, "u1")).toEqual({
      userId: "u1",
      user: { name: "Alice", image: "alice.png" },
    });
  });

  it("keeps a member's own name and takes a missing image from the task", () => {
    expect(
      findAssignee(members, "u2", { name: "Old name", image: "bob.png" }),
    ).toEqual({ userId: "u2", user: { name: "Bob", image: "bob.png" } });
  });

  it("falls back to the task's name and image for somebody who is not a project member", () => {
    expect(
      findAssignee(members, "gone", { name: "Carol", image: "carol.png" }),
    ).toEqual({ userId: "gone", user: { name: "Carol", image: "carol.png" } });
  });

  it("returns nothing without an id, or without anything to show", () => {
    expect(findAssignee(members, null, { name: "Carol" })).toBeUndefined();
    expect(findAssignee(members, "gone")).toBeUndefined();
    expect(findAssignee(undefined, "gone", { name: null })).toBeUndefined();
  });
});
