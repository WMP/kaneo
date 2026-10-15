import { describe, expect, it } from "vitest";
import type { KaneoClient } from "./kaneo.js";
import { migrate } from "./migrate.js";
import type { PlankaClient } from "./planka.js";

const board = { id: "b1", projectId: "pr1", name: "Main", position: 0 };
const target = {
  project: { id: "pr1", name: "Proj" },
  board,
  boardCountInProject: 1,
};

const card = (id: string, position: number) => ({
  id,
  boardId: "b1",
  listId: "l1",
  name: `Card ${id}`,
  description: null,
  position,
  dueDate: null,
  isDueCompleted: null,
  isClosed: null,
  commentsTotal: 0,
});

function setup(
  items: Array<{ id: string; linkedCardId: string | null; name: string }>,
  relationError?: unknown,
) {
  const relations: unknown[] = [];
  let n = 0;
  const kaneo = {
    listProjects: async () => [],
    listMembers: async () => [],
    createProject: async () => ({ id: "kp", name: "n", slug: "s" }),
    listColumns: async () => [],
    createColumn: async () => ({ id: "kc", name: "n", slug: "n" }),
    createTask: async () => ({ id: `t${++n}`, title: "t", number: n }),
    createLabel: async () => ({ id: "l", name: "n", color: "#000000" }),
    createComment: async () => ({}),
    createTaskRelation: async (input: unknown) => {
      if (relationError !== undefined) throw relationError;
      relations.push(input);
      return {};
    },
  } as unknown as KaneoClient;
  const planka = {
    getBoard: async () => ({
      item: board,
      included: {
        lists: [
          {
            id: "l1",
            boardId: "b1",
            name: "To Do",
            type: "active",
            position: 1,
            color: null,
          },
        ],
        cards: [card("c1", 1), card("c2", 2)],
        taskLists: [{ id: "tl1", cardId: "c1", name: "Steps" }],
        tasks: items.map((item, index) => ({
          ...item,
          taskListId: "tl1",
          isCompleted: false,
          position: index,
        })),
      },
    }),
  } as unknown as PlankaClient;
  return { kaneo, planka, relations };
}

const run = (ctx: ReturnType<typeof setup>) =>
  migrate({
    planka: ctx.planka,
    kaneo: ctx.kaneo,
    workspaceId: "ws1",
    targets: [target],
    dryRun: false,
    skipComments: true,
  });

describe("migrate subtask relations", () => {
  it("links a checklist item to its card as a subtask of the parent task", async () => {
    const ctx = setup([{ id: "i1", linkedCardId: "c2", name: "Link" }]);
    const [report] = await run(ctx);
    expect(ctx.relations).toEqual([
      { sourceTaskId: "t1", targetTaskId: "t2", relationType: "subtask" },
    ]);
    expect(report?.relations).toBe(1);
  });

  it("skips self links, unknown target cards and items without a link", async () => {
    const ctx = setup([
      { id: "i1", linkedCardId: "c1", name: "Self" },
      { id: "i2", linkedCardId: "missing", name: "Unknown" },
      { id: "i3", linkedCardId: null, name: "Plain" },
    ]);
    const [report] = await run(ctx);
    expect(ctx.relations).toEqual([]);
    expect(report?.relations).toBe(0);
    expect(report?.warnings).toEqual([]);
  });

  it("records a warning and keeps going when a relation cannot be created", async () => {
    const ctx = setup(
      [{ id: "i1", linkedCardId: "c2", name: "Link" }],
      new Error("Kaneo /api/task-relation: cycle"),
    );
    const [report] = await run(ctx);
    expect(report?.failed).toBe(false);
    expect(report?.relations).toBe(0);
    expect(report?.warnings).toEqual([
      'Could not link "Link" as a subtask: Kaneo /api/task-relation: cycle',
    ]);
  });

  it("stringifies non-Error relation failures", async () => {
    const ctx = setup([{ id: "i1", linkedCardId: "c2", name: "L" }], "nope");
    const [report] = await run(ctx);
    expect(report?.warnings).toEqual(['Could not link "L" as a subtask: nope']);
  });
});
