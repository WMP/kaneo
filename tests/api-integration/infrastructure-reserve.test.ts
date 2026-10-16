import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { infraWorld, modelBody } from "./helpers/infrastructure";

beforeEach(resetTestDatabase);

async function setup() {
  const w = await infraWorld();
  const url = `/api/infrastructure/project/${w.p1.id}/models`;
  const create = (overrides: Record<string, unknown>, omit: string[] = []) => {
    const body: Record<string, unknown> = modelBody(overrides);
    for (const key of omit) delete body[key];
    return w.call(w.owner, "POST", url, body);
  };
  const models = () => db.select().from(schema.infraModelTable);
  return { ...w, url, create, models };
}

describe("hypervisor reserve in GB", () => {
  it("defaults to 8 GB and never exposes the deprecated percent", async () => {
    const w = await setup();
    const res = await w.create({}, ["hypervisorReserveGb"]);
    expect(res.status, res.text).toBe(200);
    expect(res.json.hypervisorReserveGb).toBe(8);
    expect(res.json).not.toHaveProperty("hypervisorReservePercent");
    const list = await w.call(w.owner, "GET", w.url);
    expect(list.json[0].hypervisorReserveGb).toBe(8);
    expect(list.json[0]).not.toHaveProperty("hypervisorReservePercent");
    // The deprecated column keeps its default.
    expect((await w.models())[0].hypervisorReservePercent).toBe(5);
  });

  it("rejects a reserve that is not below the RAM and persists nothing", async () => {
    const w = await setup();
    for (const [ramGb, hypervisorReserveGb] of [
      [64, 64],
      [64, 100],
      [8, 8],
    ]) {
      const res = await w.create({ ramGb, hypervisorReserveGb });
      expect(res.status, `${ramGb}/${hypervisorReserveGb}`).toBe(400);
      expect(res.json.code).toBe("INFRA_RESERVE_TOO_LARGE");
    }
    // The default of 8 GB does not fit a 8 GB model either.
    const small = await w.create({ ramGb: 8 }, ["hypervisorReserveGb"]);
    expect(small.json.code).toBe("INFRA_RESERVE_TOO_LARGE");
    expect(await w.models()).toHaveLength(0);
    expect((await w.create({ ramGb: 9, hypervisorReserveGb: 8 })).status).toBe(
      200,
    );
  });

  it("checks the effective values on update, including a lower RAM", async () => {
    const w = await setup();
    const model = (await w.create({ ramGb: 64, hypervisorReserveGb: 16 })).json;
    const url = `${w.url}/${model.id}`;

    const tooLarge = await w.call(w.owner, "PUT", url, {
      hypervisorReserveGb: 64,
    });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.json.code).toBe("INFRA_RESERVE_TOO_LARGE");

    // Lowering the RAM below the stored reserve is refused too.
    const lowerRam = await w.call(w.owner, "PUT", url, { ramGb: 16 });
    expect(lowerRam.status).toBe(400);
    expect(lowerRam.json.code).toBe("INFRA_RESERVE_TOO_LARGE");
    const [row] = await w.models();
    expect(row).toMatchObject({ ramGb: 64, hypervisorReserveGb: 16 });

    const both = await w.call(w.owner, "PUT", url, {
      ramGb: 16,
      hypervisorReserveGb: 4,
    });
    expect(both.status, both.text).toBe(200);
    expect(both.json).toMatchObject({ ramGb: 16, hypervisorReserveGb: 4 });
    expect(both.json).not.toHaveProperty("hypervisorReservePercent");
  });

  it("uses RAM minus the reserve as the usable RAM of a host", async () => {
    const w = await setup();
    const model = (await w.create({ ramGb: 256, hypervisorReserveGb: 16 }))
      .json;
    const host = await w.call(
      w.owner,
      "POST",
      `/api/infrastructure/project/${w.p1.id}/hosts`,
      { modelId: model.id, region: "GRA" },
    );
    expect(host.json.hosts[0].model.hypervisorReserveGb).toBe(16);
    const capacity = await w.call(
      w.owner,
      "GET",
      `/api/infrastructure/project/${w.p1.id}/capacity`,
    );
    expect(capacity.status, capacity.text).toBe(200);
    expect(capacity.json.hosts[0].result.usableRamGb).toBe(240);
    expect(capacity.json.hosts[0].host.model.hypervisorReserveGb).toBe(16);
  });
});
