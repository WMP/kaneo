import { and, asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { infraHostTable, infraModelTable } from "../../database/schema";
import { INFRA_ERROR_CODES, infraError } from "../errors";
import { assertRegionsInCatalog } from "./regions";

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
  hypervisorReserveGb: number;
};

// The deprecated percent column is never part of a response.
function publicModel<T extends { hypervisorReservePercent: number }>(row: T) {
  const { hypervisorReservePercent: _deprecated, ...model } = row;
  return model;
}

function reserveTooLarge() {
  return infraError(
    400,
    INFRA_ERROR_CODES.reserveTooLarge,
    "The hypervisor reserve must be smaller than the model's RAM",
  );
}

// Defensive: a check violation that the API's own comparison missed answers
// like the comparison does.
function mapReserveViolation(error: unknown): never {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = e?.cause?.code ?? e?.code;
  const constraint = e?.cause?.constraint ?? e?.constraint;
  if (
    code === "23514" &&
    constraint === "ganttpro_infra_model_hypervisor_reserve_gb_check"
  ) {
    throw reserveTooLarge();
  }
  throw error;
}

export async function listModels(projectId: string) {
  const rows = await db
    .select()
    .from(infraModelTable)
    .where(eq(infraModelTable.projectId, projectId))
    .orderBy(asc(infraModelTable.position), asc(infraModelTable.createdAt));
  return rows.map(publicModel);
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

export async function createModel(
  projectId: string,
  workspaceId: string,
  input: ModelInput,
) {
  if (input.hypervisorReserveGb >= input.ramGb) throw reserveTooLarge();
  const [created] = await db
    .transaction(async (tx) => {
      await assertRegionsInCatalog(tx, workspaceId, input.regions);
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
    })
    .catch(mapReserveViolation);
  if (!created) {
    throw new HTTPException(500, { message: "Failed to create model" });
  }
  return publicModel(created);
}

export async function updateModel(
  projectId: string,
  workspaceId: string,
  modelId: string,
  input: Partial<ModelInput>,
) {
  return db
    .transaction(async (tx) => {
      const current = await lockModel(tx, projectId, modelId);
      // The effective values after the partial merge.
      const ramGb = input.ramGb ?? current.ramGb;
      const reserveGb =
        input.hypervisorReserveGb ?? current.hypervisorReserveGb;
      if (reserveGb >= ramGb) throw reserveTooLarge();

      if (input.regions) {
        await assertRegionsInCatalog(tx, workspaceId, input.regions);
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
      return publicModel(updated);
    })
    .catch(mapReserveViolation);
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
