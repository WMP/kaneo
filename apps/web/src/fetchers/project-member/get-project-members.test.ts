import { describe, expect, it } from "vitest";
import { toProjectPeople } from "./get-project-members";

describe("toProjectPeople", () => {
  it("keeps full-access users, drops inactive rows and keeps the picker shape", () => {
    const { members } = toProjectPeople([
      {
        userId: "u1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        role: "admin",
        source: "full-access",
        active: true,
      },
      {
        userId: "u2",
        name: "Bob",
        email: "bob@example.com",
        image: "https://example.com/bob.png",
        role: "member",
        source: "project",
        active: true,
      },
      {
        userId: "u3",
        name: "Old role",
        email: "old@example.com",
        image: null,
        role: "deleted-role",
        source: "project",
        active: false,
      },
    ]);

    expect(members.map((member) => member.userId)).toEqual(["u1", "u2"]);
    expect(members[1]).toMatchObject({
      id: "u2",
      role: "member",
      source: "project",
      user: {
        id: "u2",
        name: "Bob",
        email: "bob@example.com",
        image: "https://example.com/bob.png",
      },
    });
  });
});
