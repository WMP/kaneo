import { and, asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { infraHostTable, infraModelTable } from "../../database/schema";
import { INFRA_ERROR_CODES, infraError } from "../errors";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ModelInput = {
  name: string;
  provider: "ovh" | "azure" | "other";
  family?: string | null;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  regions: string[];
  leadTimeDays: number;
  hypervisorReservePercent: number;
};

export async function listModels(projectId: string) {
  return db
    .select()
    .from(infraModelTable)
    .where(eq(infraModelTable.projectId, projectId))
    .orderBy(asc(infraModelTable.position), asc(infraModelTable.createdAt));
}

// Locks the model row so that host creation, region removal and deletion for
// one model run one after another. A model of another project is a 404.
export async function lockModel(
  tx: Transaction,
  projectId: string,
  modelId: string,
) {
  const [model] = await tx
    .select()
    .from(infraModelTable)
    .where(
      and(
        eq(infraModelTable.id, modelId),
        eq(infraModelTable.projectId, projectId),
      ),
    )
    .for("update");
  if (!model) {
    throw new HTTPException(404, { message: "Infrastructure model not found" });
  }
  return model;
}

export async function createModel(projectId: string, input: ModelInput) {
  const [created] = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({
        position: sql<number>`coalesce(max(${infraModelTable.position}), -1)::int`,
      })
      .from(infraModelTable)
      .where(eq(infraModelTable.projectId, projectId));
    return tx
      .insert(infraModelTable)
      .values({
        ...input,
        family: input.family ?? null,
        projectId,
        position: (last?.position ?? -1) + 1,
      })
      .returning();
  });
  if (!created) {
    throw new HTTPException(500, { message: "Failed to create model" });
  }
  return created;
}

export async function updateModel(
  projectId: string,
  modelId: string,
  input: Partial<ModelInput>,
) {
  return db.transaction(async (tx) => {
    await lockModel(tx, projectId, modelId);

    if (input.regions) {
      const kept = input.regions;
      const used = await tx
        .selectDistinct({ region: infraHostTable.region })
        .from(infraHostTable)
        .where(eq(infraHostTable.modelId, modelId));
      const blocked = used
        .map((row) => row.region)
        .filter((region) => !kept.includes(region));
      if (blocked.length > 0) {
        throw infraError(
          409,
          INFRA_ERROR_CODES.regionInUse,
          `Hosts still use the region(s): ${blocked.join(", ")}`,
        );
      }
    }

    const [updated] = await tx
      .update(infraModelTable)
      .set(input)
      .where(eq(infraModelTable.id, modelId))
      .returning();
    if (!updated) {
      throw new HTTPException(404, {
        message: "Infrastructure model not found",
      });
    }
    return updated;
  });
}

export async function deleteModel(projectId: string, modelId: string) {
  await db.transaction(async (tx) => {
    await lockModel(tx, projectId, modelId);
    const [used] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(infraHostTable)
      .where(eq(infraHostTable.modelId, modelId));
    if ((used?.count ?? 0) > 0) {
      throw infraError(
        409,
        INFRA_ERROR_CODES.modelInUse,
        "Hosts use this model. Delete them first.",
      );
    }
    await tx.delete(infraModelTable).where(eq(infraModelTable.id, modelId));
  });
  return { id: modelId };
}
