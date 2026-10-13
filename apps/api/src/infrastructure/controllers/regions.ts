import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  infraHostTable,
  infraModelTable,
  infraRegionTable,
  infraStorageClusterTable,
  projectTable,
} from "../../database/schema";
import { INFRA_ERROR_CODES, infraError } from "../errors";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Region codes that models and clusters name must exist in the workspace
// catalog. The matching rows are read FOR SHARE, so a concurrent delete of a
// region (which locks the row FOR UPDATE) waits for this write to commit.
export async function assertRegionsInCatalog(
  tx: Transaction,
  workspaceId: string,
  codes: string[],
) {
  const wanted = [...new Set(codes)];
  if (wanted.length === 0) return;
  const rows = await tx
    .select({ code: infraRegionTable.code })
    .from(infraRegionTable)
    .where(
      and(
        eq(infraRegionTable.workspaceId, workspaceId),
        inArray(infraRegionTable.code, wanted),
      ),
    )
    .for("share");
  const known = new Set(rows.map((row) => row.code));
  const unknown = wanted.filter((code) => !known.has(code));
  if (unknown.length > 0) {
    throw infraError(
      400,
      INFRA_ERROR_CODES.regionUnknown,
      `Unknown region(s): ${unknown.join(", ")}. Add them to the workspace regions first.`,
    );
  }
}

// What the project pickers need: code and name only.
export async function listProjectRegions(workspaceId: string) {
  return db
    .select({ code: infraRegionTable.code, name: infraRegionTable.name })
    .from(infraRegionTable)
    .where(eq(infraRegionTable.workspaceId, workspaceId))
    .orderBy(asc(infraRegionTable.position), asc(infraRegionTable.code));
}

// Catalog with usage counts (models of the workspace's projects that list the
// code, hosts and clusters of the workspace that use it) in four queries.
export async function listRegions(workspaceId: string) {
  const regions = await db
    .select()
    .from(infraRegionTable)
    .where(eq(infraRegionTable.workspaceId, workspaceId))
    .orderBy(asc(infraRegionTable.position), asc(infraRegionTable.code));

  const models = await db
    .select({
      code: sql<string>`jsonb_array_elements_text(${infraModelTable.regions})`,
      count: sql<number>`count(*)::int`,
    })
    .from(infraModelTable)
    .innerJoin(projectTable, eq(projectTable.id, infraModelTable.projectId))
    .where(eq(projectTable.workspaceId, workspaceId))
    .groupBy(sql`1`);
  const hosts = await db
    .select({
      code: infraHostTable.region,
      count: sql<number>`count(*)::int`,
    })
    .from(infraHostTable)
    .innerJoin(projectTable, eq(projectTable.id, infraHostTable.projectId))
    .where(eq(projectTable.workspaceId, workspaceId))
    .groupBy(infraHostTable.region);
  const clusters = await db
    .select({
      code: infraStorageClusterTable.region,
      count: sql<number>`count(*)::int`,
    })
    .from(infraStorageClusterTable)
    .where(eq(infraStorageClusterTable.workspaceId, workspaceId))
    .groupBy(infraStorageClusterTable.region);

  const countOf = (rows: { code: string; count: number }[], code: string) =>
    rows.find((row) => row.code === code)?.count ?? 0;
  return regions.map((region) => ({
    ...region,
    usage: {
      models: countOf(models, region.code),
      hosts: countOf(hosts, region.code),
      clusters: countOf(clusters, region.code),
    },
  }));
}

async function getRegion(workspaceId: string, regionId: string) {
  const [region] = (await listRegions(workspaceId)).filter(
    (item) => item.id === regionId,
  );
  if (!region) {
    throw new HTTPException(404, { message: "Region not found" });
  }
  return region;
}

function pgCode(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

export async function createRegion(
  workspaceId: string,
  input: { code: string; name: string },
) {
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [last] = await tx
        .select({
          position: sql<number>`coalesce(max(${infraRegionTable.position}), -1)::int`,
        })
        .from(infraRegionTable)
        .where(eq(infraRegionTable.workspaceId, workspaceId));
      const [created] = await tx
        .insert(infraRegionTable)
        .values({
          workspaceId,
          code: input.code,
          name: input.name,
          position: (last?.position ?? -1) + 1,
        })
        .returning({ id: infraRegionTable.id });
      if (!created) {
        throw new HTTPException(500, { message: "Failed to create region" });
      }
      return created.id;
    });
  } catch (error) {
    if (pgCode(error) === "23505") {
      throw infraError(
        409,
        INFRA_ERROR_CODES.regionCodeTaken,
        `Region ${input.code} already exists in the workspace`,
      );
    }
    throw error;
  }
  return getRegion(workspaceId, id);
}

// The code is immutable: only the name and the position change.
export async function updateRegion(
  workspaceId: string,
  regionId: string,
  input: { name?: string; position?: number },
) {
  const updated = await db
    .update(infraRegionTable)
    .set({ name: input.name, position: input.position })
    .where(
      and(
        eq(infraRegionTable.id, regionId),
        eq(infraRegionTable.workspaceId, workspaceId),
      ),
    )
    .returning({ id: infraRegionTable.id });
  if (updated.length === 0) {
    throw new HTTPException(404, { message: "Region not found" });
  }
  return getRegion(workspaceId, regionId);
}

export async function deleteRegion(workspaceId: string, regionId: string) {
  await db.transaction(async (tx) => {
    const [region] = await tx
      .select()
      .from(infraRegionTable)
      .where(
        and(
          eq(infraRegionTable.id, regionId),
          eq(infraRegionTable.workspaceId, workspaceId),
        ),
      )
      .for("update");
    if (!region) throw new HTTPException(404, { message: "Region not found" });

    const [models] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(infraModelTable)
      .innerJoin(projectTable, eq(projectTable.id, infraModelTable.projectId))
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          sql`${infraModelTable.regions} ? ${region.code}`,
        ),
      );
    const [hosts] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(infraHostTable)
      .innerJoin(projectTable, eq(projectTable.id, infraHostTable.projectId))
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          eq(infraHostTable.region, region.code),
        ),
      );
    const [clusters] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(infraStorageClusterTable)
      .where(
        and(
          eq(infraStorageClusterTable.workspaceId, workspaceId),
          eq(infraStorageClusterTable.region, region.code),
        ),
      );
    if (
      (models?.count ?? 0) + (hosts?.count ?? 0) + (clusters?.count ?? 0) >
      0
    ) {
      throw infraError(
        409,
        INFRA_ERROR_CODES.regionInUse,
        "A model, host or storage cluster still uses this region",
      );
    }
    await tx.delete(infraRegionTable).where(eq(infraRegionTable.id, regionId));
  });
  return { id: regionId };
}
