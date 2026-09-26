import { describe, expect, it } from "vitest";
import { buildFullTaskUpdateBody } from "./task-helpers.js";

describe("buildFullTaskUpdateBody", () => {
  it("merges patch onto existing task", () => {
    // Arrange
    const original = {
      title: "T",
      description: "D",
      status: "open",
      priority: "low",
      projectId: "p1",
      position: 1,
      userId: "u1",
    };
    const patch = { status: "done" as const };

    // Act
    const body = buildFullTaskUpdateBody(original, patch);

    // Assert
    expect(body.status).toBe("done");
    expect(body.title).toBe("T");
    expect(body.position).toBe(1);
  });

  it("forwards progress, isMilestone, and constraintType/constraintDate when provided", () => {
    const original = {
      title: "T",
      description: "D",
      status: "open",
      priority: "low",
      projectId: "p1",
      position: 1,
    };
    const patch = {
      progress: 55,
      isMilestone: true,
      constraintType: "start_no_earlier_than" as const,
      constraintDate: "2026-02-01T00:00:00Z",
    };

    const body = buildFullTaskUpdateBody(original, patch);

    expect(body.progress).toBe(55);
    expect(body.isMilestone).toBe(true);
    expect(body.constraintType).toBe("start_no_earlier_than");
    expect(body.constraintDate).toBe("2026-02-01T00:00:00Z");
  });

  it("leaves progress, isMilestone, and constraintType/constraintDate untouched when omitted", () => {
    const original = {
      title: "T",
      description: "D",
      status: "open",
      priority: "low",
      projectId: "p1",
      position: 1,
      progress: 10,
      isMilestone: true,
      constraintType: "must_start_on",
      constraintDate: "2026-01-01T00:00:00Z",
    };
    const patch = { status: "done" as const };

    const body = buildFullTaskUpdateBody(original, patch);

    expect(body).not.toHaveProperty("progress");
    expect(body).not.toHaveProperty("isMilestone");
    expect(body).not.toHaveProperty("constraintType");
    expect(body).not.toHaveProperty("constraintDate");
  });

  it("clears constraintDate to null when constraintType is set to none without an explicit date", () => {
    const original = {
      title: "T",
      description: "D",
      status: "open",
      priority: "low",
      projectId: "p1",
      position: 1,
    };
    const patch = { constraintType: "none" as const };

    const body = buildFullTaskUpdateBody(original, patch);

    expect(body.constraintType).toBe("none");
    expect(body.constraintDate).toBeNull();
  });
});
