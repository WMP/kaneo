import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
  getPrivateObject: vi.fn(),
  deleteS3Object: vi.fn(async () => undefined),
}));
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/api/src/storage/s3")>()),
  getPrivateObject: s3.getPrivateObject,
  deleteS3Object: s3.deleteS3Object,
}));

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import archiveProject from "../../apps/api/src/project/controllers/archive-project";
import getProject from "../../apps/api/src/project/controllers/get-project";
import moveProject from "../../apps/api/src/project/controllers/move-project";
import unarchiveProject from "../../apps/api/src/project/controllers/unarchive-project";
import updateProject from "../../apps/api/src/project/controllers/update-project";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

function storedProject(id: string) {
  return db.query.projectTable.findFirst({
    where: eq(schema.projectTable.id, id),
  });
}

function stream(text: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function put(path: string, body: unknown) {
  return createApp().app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post(path: string, body: unknown) {
  return createApp().app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("API integration: project controllers refuse a project of another workspace", () => {
  it("archive, unarchive, update, get and move answer 404 or 400 and leave the project untouched", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Original",
    });

    await expect(
      archiveProject(project.id, other.workspace.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      unarchiveProject(project.id, other.workspace.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateProject(
        project.id,
        "Hijacked",
        "Folder",
        "x",
        "",
        false,
        other.workspace.id,
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getProject(project.id, other.workspace.id),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      moveProject(
        project.id,
        other.workspace.id,
        owner.workspace.id,
        owner.user.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      moveProject(
        project.id,
        owner.workspace.id,
        owner.workspace.id,
        owner.user.id,
      ),
    ).rejects.toMatchObject({ status: 400 });

    const row = await storedProject(project.id);
    expect(row).toMatchObject({
      name: "Original",
      workspaceId: owner.workspace.id,
      archivedAt: null,
    });
  });

  it("refuses to flip visibility without the share permission and keeps the stored value", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await expect(
      updateProject(
        project.id,
        project.name,
        "Folder",
        project.slug,
        "",
        true,
        owner.workspace.id,
        false,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect((await storedProject(project.id))?.isPublic).toBe(false);
  });
});

describe("API integration: public project read", () => {
  it("answers 404 for an unknown project, 403 for a private one and the board for a public one", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const { app } = createApp();

    expect((await app.request("/api/public-project/missing")).status).toBe(404);
    expect(
      (await app.request(`/api/public-project/${project.id}`)).status,
    ).toBe(403);

    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, project.id));
    const response = await app.request(`/api/public-project/${project.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: project.id,
      isPublic: true,
    });
  });
});

describe("API integration: project background streaming", () => {
  async function seed(key: string | null, mime: string | null = "image/png") {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({
        backgroundObjectKey: key,
        backgroundMimeType: mime,
        backgroundVersion: key ? "v7" : null,
      })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(owner.user);
    return { owner, project };
  }

  it("answers 404 when the project has no background and never asks the storage", async () => {
    const { project } = await seed(null);
    const response = await createApp().app.request(
      `/api/project/${project.id}/background`,
    );
    expect(response.status).toBe(404);
    expect(s3.getPrivateObject).not.toHaveBeenCalled();
  });

  it("streams an image with private caching headers and the stored etag", async () => {
    const { project } = await seed("workspace/w/project/p/backgrounds/b-v7");
    s3.getPrivateObject.mockResolvedValue({
      body: stream("PNGDATA"),
      contentType: "image/png; charset=binary",
      contentLength: 7,
      etag: '"abc"',
      lastModified: new Date("2026-02-03T04:05:06.000Z"),
    });

    const response = await createApp().app.request(
      `/api/project/${project.id}/background`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("PNGDATA");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("7");
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("last-modified")).toBe(
      "Tue, 03 Feb 2026 04:05:06 GMT",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=300, must-revalidate",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(s3.getPrivateObject).toHaveBeenCalledWith(
      "workspace/w/project/p/backgrounds/b-v7",
    );
  });

  it("answers 304 without a body when If-None-Match equals the etag, falling back to the stored version", async () => {
    const { project } = await seed("k", "image/webp");
    s3.getPrivateObject.mockResolvedValue({
      body: stream("x"),
      contentType: undefined,
      contentLength: undefined,
      etag: undefined,
      lastModified: undefined,
    });

    const response = await createApp().app.request(
      `/api/project/${project.id}/background`,
      {
        headers: { "if-none-match": '"v7"' },
      },
    );
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).toBe("image/webp");
  });

  it("answers 404 when the stored object is not an image", async () => {
    const { project } = await seed("k", "text/html");
    s3.getPrivateObject.mockResolvedValue({
      body: stream("<script>"),
      contentType: "text/html",
    });
    const response = await createApp().app.request(
      `/api/project/${project.id}/background`,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("<script>");
  });

  it("answers 404 when the storage fails", async () => {
    const { project } = await seed("k");
    s3.getPrivateObject.mockRejectedValue(new Error("NoSuchKey"));
    const response = await createApp().app.request(
      `/api/project/${project.id}/background`,
    );
    expect(response.status).toBe(404);
  });
});

describe("API integration: project background upload errors", () => {
  function configureStorage() {
    vi.stubEnv("S3_ENDPOINT", "https://storage.example.test");
    vi.stubEnv("S3_BUCKET", "test-backgrounds");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("S3_KEY_PREFIX", "");
  }

  async function seed() {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    mockAuthenticatedSession(owner.user);
    return { owner, project };
  }

  it("rejects a non-image content type with 400 and a presign request with unconfigured storage with 503", async () => {
    const { project } = await seed();
    configureStorage();
    const bad = await put(`/api/project/${project.id}/background-upload`, {
      contentType: "text/html",
      size: 10,
    });
    expect(bad.status).toBe(400);

    vi.stubEnv("S3_ENDPOINT", "");
    const unconfigured = await put(
      `/api/project/${project.id}/background-upload`,
      {
        contentType: "image/png",
        size: 10,
      },
    );
    expect(unconfigured.status).toBe(503);
  });

  it("finalize rejects an invalid image, a foreign key, and keeps the stored background", async () => {
    const { owner, project } = await seed();
    configureStorage();
    const base = `/api/project/${project.id}/background-upload/finalize`;

    const invalid = await post(base, {
      key: "k",
      version: "v1",
      contentType: "application/pdf",
      size: 10,
    });
    expect(invalid.status).toBe(400);

    const foreign = await post(base, {
      key: `workspace/${owner.workspace.id}/project/another-project/backgrounds/background-v1`,
      version: "v1",
      contentType: "image/png",
      size: 10,
    });
    expect(foreign.status).toBe(400);
    expect(await foreign.text()).toBe(
      "Image upload key does not match the project context.",
    );
    expect((await storedProject(project.id))?.backgroundObjectKey).toBeNull();
  });

  it("replacing a background deletes the previous object from storage", async () => {
    const { owner, project } = await seed();
    configureStorage();
    const base = `/api/project/${project.id}/background-upload/finalize`;
    const keyFor = (v: string) =>
      `workspace/${owner.workspace.id}/project/${project.id}/backgrounds/background-${v}`;

    const first = await post(base, {
      key: keyFor("v1"),
      version: "v1",
      contentType: "image/png",
      size: 10,
    });
    expect(first.status).toBe(200);
    expect(s3.deleteS3Object).not.toHaveBeenCalled();

    const second = await post(base, {
      key: keyFor("v2"),
      version: "v2",
      contentType: "image/png",
      size: 10,
    });
    expect(second.status).toBe(200);
    expect((await second.json()).url).toMatch(
      /\/project\/.+\/background\?v=v2$/,
    );
    expect(s3.deleteS3Object).toHaveBeenCalledWith(keyFor("v1"));
    expect((await storedProject(project.id))?.backgroundObjectKey).toBe(
      keyFor("v2"),
    );
  });
});
