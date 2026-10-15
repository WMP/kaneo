import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeEntitlement,
  getOrCreateWorkspaceBilling,
} from "../../apps/api/src/billing/controllers/get-workspace-billing";
import {
  requireProjectEntitlement,
  requireWorkspaceEntitlement,
} from "../../apps/api/src/billing/controllers/require-entitlement";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const SECRET = "webhook-secret-for-tests";
const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function billingRow(workspaceId: string) {
  return db.query.workspaceBillingTable.findFirst({
    where: eq(schema.workspaceBillingTable.workspaceId, workspaceId),
  });
}

function api(path: string, init?: RequestInit) {
  return createApp().app.request(`/api/billing${path}`, init);
}

function post(path: string, body: unknown) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signedWebhook(payload: unknown, secret = SECRET) {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return api("/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "creem-signature": signature,
    },
    body: raw,
  });
}

beforeEach(async () => {
  await resetTestDatabase();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("KANEO_CLOUD", "true");
  vi.stubEnv("CREEM_API_KEY", "creem_test_key");
  vi.stubEnv("CREEM_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("CREEM_TEST_MODE", "true");
  vi.stubEnv("CREEM_PRODUCT_TEAM_MONTHLY", "prod_team_monthly");
  vi.stubEnv("KANEO_CLIENT_URL", "https://app.example");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("API integration: billing routes (Creem HTTP stubbed)", () => {
  it("serves the workspace billing state to a member and refuses an outsider", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });

    mockAuthenticatedSession(outsider.user);
    expect((await api(`/${owner.workspace.id}`)).status).toBe(403);
    expect(await billingRow(owner.workspace.id)).toBeUndefined();

    mockAuthenticatedSession(owner.user);
    const response = await api(`/${owner.workspace.id}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      billingEnabled: true,
      hasCustomer: false,
      entitlement: { active: true, reason: "trial" },
    });
    expect(await billingRow(owner.workspace.id)).toBeDefined();
  });

  it("creates a checkout for a team plan sized by the member count, for owners and admins only", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await addWorkspaceMember(owner.workspace.id, "member");
    const admin = await addWorkspaceMember(owner.workspace.id, "admin");
    const plain = await addWorkspaceMember(owner.workspace.id, "member");
    fetchMock.mockResolvedValue(
      json({
        id: "ch_1",
        object: "checkout",
        status: "pending",
        product: "prod_team_monthly",
        mode: "test",
        checkout_url: "https://checkout.example/ch_1",
      }),
    );

    mockAuthenticatedSession(plain);
    const denied = await post(`/${owner.workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });
    expect(denied.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    mockAuthenticatedSession(admin);
    const ok = await post(`/${owner.workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      checkoutUrl: "https://checkout.example/ch_1",
    });
    const [input, init] = fetchMock.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const request = input instanceof Request ? input : new Request(input, init);
    // 4 workspace members: owner, member, admin, plain member.
    expect(await request.json()).toMatchObject({
      product_id: "prod_team_monthly",
      units: 4,
      success_url:
        "https://app.example/dashboard/settings/workspace/billing?checkout=success",
      customer: { email: admin.email },
      metadata: {
        workspaceId: owner.workspace.id,
        plan: "team",
        interval: "monthly",
      },
    });
  });

  it("rejects a plan without a configured product and an already active subscription", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);

    const unknown = await post(`/${owner.workspace.id}/checkout`, {
      plan: "personal",
      interval: "annual",
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toBe("Unknown plan");

    await getOrCreateWorkspaceBilling(owner.workspace.id);
    await db
      .update(schema.workspaceBillingTable)
      .set({ status: "active" })
      .where(eq(schema.workspaceBillingTable.workspaceId, owner.workspace.id));
    const active = await post(`/${owner.workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });
    expect(active.status).toBe(400);
    expect(await active.text()).toBe(
      "Workspace already has an active subscription",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 400 for a checkout when billing is not enabled", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    vi.stubEnv("CREEM_API_KEY", "");

    const response = await post(`/${owner.workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Billing is not enabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 when the provider fails during checkout", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    fetchMock.mockResolvedValue(json({ message: "boom" }, 500));

    const response = await post(`/${owner.workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });
    expect(response.status).toBe(502);
  });

  it("creates a portal link only once a customer exists", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);

    const none = await post(`/${owner.workspace.id}/portal`, {});
    expect(none.status).toBe(400);
    expect(await none.text()).toBe(
      "No billing customer exists for this workspace yet",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await db
      .update(schema.workspaceBillingTable)
      .set({ creemCustomerId: "cust_42" })
      .where(eq(schema.workspaceBillingTable.workspaceId, owner.workspace.id));
    fetchMock.mockResolvedValue(
      json({
        id: "cust_42",
        object: "customer",
        customer_portal_link: "https://portal.example/cust_42",
      }),
    );
    const ok = await post(`/${owner.workspace.id}/portal`, {});
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      portalUrl: "https://portal.example/cust_42",
    });
    const [input, init] = fetchMock.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const request = input instanceof Request ? input : new Request(input, init);
    expect(await request.json()).toMatchObject({ customer_id: "cust_42" });
  });

  it("refuses the portal to a plain member", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const plain = await addWorkspaceMember(owner.workspace.id, "member");
    mockAuthenticatedSession(plain);
    const response = await post(`/${owner.workspace.id}/portal`, {});
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies the webhook signature before touching billing state", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceBillingTable).values({
      workspaceId: owner.workspace.id,
      status: "trialing",
      creemSubscriptionId: "sub_1",
    });
    const payload = {
      id: "evt_1",
      eventType: "subscription.canceled",
      object: { id: "sub_1", status: "canceled" },
    };

    const forged = await signedWebhook(payload, "another-secret");
    expect(forged.status).toBe(400);
    expect((await billingRow(owner.workspace.id))?.status).toBe("trialing");

    const unsigned = await api("/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(unsigned.status).toBe(400);
    expect((await billingRow(owner.workspace.id))?.status).toBe("trialing");

    const valid = await signedWebhook(payload);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ processed: true, duplicate: false });
    expect((await billingRow(owner.workspace.id))?.status).toBe("canceled");

    const replay = await signedWebhook(payload);
    expect(await replay.json()).toEqual({ processed: false, duplicate: true });
  });

  it("answers 404 for the webhook when billing is not configured", async () => {
    vi.stubEnv("CREEM_WEBHOOK_SECRET", "");
    const response = await signedWebhook({
      id: "e",
      eventType: "x",
      object: {},
    });
    expect(response.status).toBe(404);
  });
});

describe("API integration: billing webhook event handling", () => {
  async function handle(
    event: Parameters<
      typeof import("../../apps/api/src/billing/controllers/handle-webhook").default
    >[0],
  ) {
    const mod = await import(
      "../../apps/api/src/billing/controllers/handle-webhook"
    );
    return mod.default(event);
  }

  it("checkout.completed links customer and subscription to the workspace in metadata", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await getOrCreateWorkspaceBilling(owner.workspace.id);

    const result = await handle({
      id: "evt_c1",
      type: "checkout.completed",
      data: {
        metadata: { workspaceId: owner.workspace.id },
        product: { id: "prod_team_monthly" },
        customer: { id: "cust_9" },
        subscription: { id: "sub_9", status: "trialing" },
      },
    });

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(await billingRow(owner.workspace.id)).toMatchObject({
      creemCustomerId: "cust_9",
      creemSubscriptionId: "sub_9",
      creemProductId: "prod_team_monthly",
      plan: "team",
      billingInterval: "monthly",
      status: "trialing",
    });
  });

  it("checkout.completed without a workspace id changes nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await getOrCreateWorkspaceBilling(owner.workspace.id);

    const result = await handle({
      id: "evt_c2",
      type: "checkout.completed",
      data: { subscription: { id: "sub_x", status: "active" } },
    });

    expect(result).toEqual({ processed: false, duplicate: false });
    expect(
      (await billingRow(owner.workspace.id))?.creemSubscriptionId,
    ).toBeNull();
  });

  it("a subscription event without an id is not processed", async () => {
    const result = await handle({
      id: "evt_s0",
      type: "subscription.paid",
      data: { status: "active" },
    });
    expect(result).toEqual({ processed: false, duplicate: false });
  });

  it("a subscription event for an unknown subscription binds it by metadata workspace id", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await getOrCreateWorkspaceBilling(owner.workspace.id);

    await handle({
      id: "evt_s1",
      type: "subscription.paid",
      data: {
        id: "sub_new",
        metadata: { workspaceId: owner.workspace.id },
        current_period_end_date: "2026-12-01T00:00:00.000Z",
        items: [{ units: 5 }],
      },
    });

    const row = await billingRow(owner.workspace.id);
    expect(row).toMatchObject({
      creemSubscriptionId: "sub_new",
      status: "active",
      seats: 5,
    });
    expect(row?.currentPeriodEnd?.toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
  });

  it("applies camelCase period fields and ignores an unparseable date", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceBillingTable).values({
      workspaceId: owner.workspace.id,
      creemSubscriptionId: "sub_c",
      currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"),
    });

    await handle({
      type: "subscription.active",
      data: {
        id: "sub_c",
        currentPeriodEndDate: "2026-03-05T00:00:00.000Z",
        canceledAt: "2026-02-01T00:00:00.000Z",
      },
    });
    let row = await billingRow(owner.workspace.id);
    expect(row?.currentPeriodEnd?.toISOString()).toBe(
      "2026-03-05T00:00:00.000Z",
    );
    expect(row?.canceledAt?.toISOString()).toBe("2026-02-01T00:00:00.000Z");

    await handle({
      type: "subscription.active",
      data: {
        id: "sub_c",
        currentPeriodEndDate: "not-a-date",
        canceled_at: null,
      },
    });
    row = await billingRow(owner.workspace.id);
    expect(row?.currentPeriodEnd).toBeNull();
    expect(row?.canceledAt).toBeNull();
  });

  it("an event type that is neither checkout nor subscription is acknowledged without changes", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await getOrCreateWorkspaceBilling(owner.workspace.id);
    const before = await billingRow(owner.workspace.id);

    expect(
      await handle({ id: "evt_r", type: "refund.created", data: {} }),
    ).toEqual({
      processed: true,
      duplicate: false,
    });
    expect(await billingRow(owner.workspace.id)).toEqual(before);
  });
});

describe("API integration: billing entitlement helpers", () => {
  it("getOrCreateWorkspaceBilling answers 404 for an unknown workspace and creates nothing", async () => {
    await expect(
      getOrCreateWorkspaceBilling("missing-workspace"),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(await db.select().from(schema.workspaceBillingTable)).toHaveLength(
      0,
    );
  });

  it("computeEntitlement ranks founding, subscription, paid period, trial and expiry", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const base = await getOrCreateWorkspaceBilling(owner.workspace.id);
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    const row = {
      ...base,
      foundingFree: false,
      status: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
    };

    expect(computeEntitlement({ ...row, foundingFree: true }).reason).toBe(
      "founding_free",
    );
    expect(computeEntitlement({ ...row, status: "active" }).reason).toBe(
      "subscription",
    );
    expect(
      computeEntitlement({
        ...row,
        status: "canceled",
        currentPeriodEnd: future,
      }).reason,
    ).toBe("paid_period");
    expect(
      computeEntitlement({
        ...row,
        status: "canceled",
        currentPeriodEnd: past,
      }),
    ).toEqual({ active: false, reason: "expired" });
    expect(computeEntitlement({ ...row, trialEndsAt: future }).reason).toBe(
      "trial",
    );

    vi.stubEnv("CREEM_API_KEY", "");
    expect(computeEntitlement(row)).toEqual({
      active: true,
      reason: "billing_disabled",
    });
    vi.unstubAllEnvs();
  });

  it("requireWorkspaceEntitlement answers 402 for an expired workspace and passes when billing is off", async () => {
    vi.stubEnv("KANEO_CLOUD", "true");
    vi.stubEnv("CREEM_API_KEY", "k");
    vi.stubEnv("CREEM_WEBHOOK_SECRET", "s");
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db.insert(schema.workspaceBillingTable).values({
      workspaceId: owner.workspace.id,
      trialEndsAt: new Date(Date.now() - 1000),
    });

    await expect(
      requireWorkspaceEntitlement(owner.workspace.id),
    ).rejects.toMatchObject({ status: 402 });
    await expect(requireProjectEntitlement(project.id)).rejects.toMatchObject({
      status: 402,
    });
    // An unknown project is not this guard's business.
    await expect(
      requireProjectEntitlement("missing-project"),
    ).resolves.toBeUndefined();

    vi.stubEnv("CREEM_API_KEY", "");
    await expect(
      requireWorkspaceEntitlement(owner.workspace.id),
    ).resolves.toBeUndefined();
    await expect(
      requireProjectEntitlement(project.id),
    ).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe("API integration: billing initialisation edge cases", () => {
  it("a workspace without an owner gets the default trial from now", async () => {
    vi.stubEnv("BILLING_TRIAL_DAYS", "10");
    const owner = await createWorkspaceMember({ role: "admin" });
    const before = Date.now();

    const row = await getOrCreateWorkspaceBilling(owner.workspace.id);

    const days = ((row.trialEndsAt?.getTime() ?? 0) - before) / 86_400_000;
    expect(days).toBeGreaterThan(9.99);
    expect(days).toBeLessThan(10.01);
  });

  it("concurrent initialisation of one workspace leaves exactly one billing row", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });

    const [a, b] = await Promise.all([
      getOrCreateWorkspaceBilling(owner.workspace.id),
      getOrCreateWorkspaceBilling(owner.workspace.id),
    ]);

    expect(a.id).toBe(b.id);
    expect(await db.select().from(schema.workspaceBillingTable)).toHaveLength(
      1,
    );
  });

  it("a subscription event stores the customer id and the seat count", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceBillingTable).values({
      workspaceId: owner.workspace.id,
      creemSubscriptionId: "sub_cust",
    });
    const handleWebhook = (
      await import("../../apps/api/src/billing/controllers/handle-webhook")
    ).default;

    await handleWebhook({
      type: "subscription.active",
      data: {
        id: "sub_cust",
        customer: { id: "cust_77" },
        items: [{ units: 6 }],
      },
    });

    expect(await billingRow(owner.workspace.id)).toMatchObject({
      creemCustomerId: "cust_77",
      seats: 6,
      status: "active",
    });
  });
});
