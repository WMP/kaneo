import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutSession,
  createCustomerPortalLink,
  updateSubscriptionSeats,
} from "../../../apps/api/src/billing/creem-client";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestOf(call: unknown[]): Request {
  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
  return input instanceof Request ? input : new Request(input, init);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CREEM_API_KEY", "creem_test_key");
  vi.stubEnv("CREEM_TEST_MODE", "true");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Creem client (external HTTP stubbed)", () => {
  it("creates a checkout against the test host and returns only the URL", async () => {
    fetchMock.mockResolvedValue(
      json({
        id: "ch_1",
        object: "checkout",
        status: "pending",
        product: "prod_1",
        mode: "test",
        checkout_url: "https://checkout.example/ch_1",
      }),
    );

    const result = await createCheckoutSession({
      productId: "prod_1",
      units: 3,
      successUrl: "https://app.example/ok",
      requestId: "req-1",
      customerEmail: "buyer@example.com",
      metadata: { workspaceId: "w1" },
    });

    expect(result).toEqual({ checkoutUrl: "https://checkout.example/ch_1" });
    const request = requestOf(fetchMock.mock.calls[0] as unknown[]);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).host).toBe("test-api.creem.io");
    expect(request.headers.get("x-api-key")).toBe("creem_test_key");
    const body = await request.json();
    expect(body).toMatchObject({
      product_id: "prod_1",
      units: 3,
      request_id: "req-1",
      success_url: "https://app.example/ok",
      customer: { email: "buyer@example.com" },
      metadata: { workspaceId: "w1" },
    });
  });

  it("uses the production host when test mode is off", async () => {
    vi.stubEnv("CREEM_TEST_MODE", "false");
    fetchMock.mockResolvedValue(
      json({
        id: "cu",
        object: "customer",
        customer_portal_link: "https://p/x",
      }),
    );

    await createCustomerPortalLink("cust_1");

    const request = requestOf(fetchMock.mock.calls[0] as unknown[]);
    expect(new URL(request.url).host).toBe("api.creem.io");
  });

  it("answers 502 when the provider returns no checkout URL", async () => {
    fetchMock.mockResolvedValue(
      json({
        id: "ch_1",
        object: "checkout",
        status: "pending",
        product: "p",
        mode: "test",
      }),
    );

    await expect(
      createCheckoutSession({
        productId: "p",
        units: 1,
        successUrl: "https://app.example/ok",
        requestId: "r",
        customerEmail: "a@example.com",
        metadata: {},
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: "Billing provider request failed",
    });
  });

  it("answers 502 without leaking provider details when checkout fails upstream", async () => {
    fetchMock.mockResolvedValue(
      json({ message: "secret upstream detail" }, 500),
    );

    await expect(
      createCheckoutSession({
        productId: "p",
        units: 1,
        successUrl: "https://app.example/ok",
        requestId: "r",
        customerEmail: "a@example.com",
        metadata: {},
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: "Billing provider request failed",
    });
  });

  it("updates seats with proration and reports ok", async () => {
    fetchMock.mockResolvedValue(
      json({
        id: "sub_1",
        object: "subscription",
        mode: "test",
        product: "prod_1",
        customer: "cust_1",
        collection_method: "charge_automatically",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
    );

    const result = await updateSubscriptionSeats({
      subscriptionId: "sub_1",
      productId: "prod_1",
      units: 7,
    });

    expect(result).toEqual({ ok: true });
    const request = requestOf(fetchMock.mock.calls[0] as unknown[]);
    expect(new URL(request.url).pathname).toContain("/v1/subscriptions/sub_1");
    expect(await request.json()).toMatchObject({
      items: [{ product_id: "prod_1", units: 7 }],
      update_behavior: "proration-charge",
    });
  });

  it("reports ok:false instead of throwing when the seat update fails", async () => {
    fetchMock.mockResolvedValue(json({ message: "nope" }, 400));
    expect(
      await updateSubscriptionSeats({
        subscriptionId: "sub_1",
        productId: "p",
        units: 2,
      }),
    ).toEqual({ ok: false });

    fetchMock.mockRejectedValue(new TypeError("network down"));
    expect(
      await updateSubscriptionSeats({
        subscriptionId: "sub_1",
        productId: "p",
        units: 2,
      }),
    ).toEqual({ ok: false });
  });

  it("returns the portal link and answers 502 when the provider fails", async () => {
    fetchMock.mockResolvedValue(
      json({
        id: "cu",
        object: "customer",
        customer_portal_link: "https://portal.example/c1",
      }),
    );
    expect(await createCustomerPortalLink("cust_1")).toEqual({
      portalUrl: "https://portal.example/c1",
    });

    fetchMock.mockRejectedValue(new TypeError("network down"));
    await expect(createCustomerPortalLink("cust_1")).rejects.toMatchObject({
      status: 502,
      message: "Billing provider request failed",
    });
  });
});
