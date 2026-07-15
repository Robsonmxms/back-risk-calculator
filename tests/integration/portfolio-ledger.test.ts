import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSeededIdentityStore } from "../../src/04-infra/repositories/InMemoryIdentityStore";

async function login(app: Parameters<typeof request>[0], email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

describe("portfolio ledger", () => {
  it("lists only portfolios visible to the authenticated actor", async () => {
    const { app } = await createApp();
    const token = await login(app, "analyst@example.com");

    const response = await request(app)
      .get("/api/v1/portfolios")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.meta.count).toBe(2);
    expect(response.body.data.portfolios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "prt_main",
          accountId: "acct_main",
          membershipRole: "analyst"
        }),
        expect.objectContaining({
          id: "prt_income",
          status: "degraded",
          analyticsState: "pending"
        })
      ])
    );
  });

  it("creates a portfolio for an owned account and emits an outbox event", async () => {
    const identityStore = await createSeededIdentityStore();
    const { app } = await createApp({ identityStore });
    const token = await login(app, "user@example.com");

    const response = await request(app)
      .post("/api/v1/portfolios")
      .set("Authorization", `Bearer ${token}`)
      .send({
        accountId: "acct_main",
        name: "Dividendos Brasil",
        description: "Mandato de renda",
        baseCurrency: "BRL"
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      accountId: "acct_main",
      name: "Dividendos Brasil",
      baseCurrency: "BRL"
    });

    const outbox = await identityStore.listOutboxEvents();
    expect(outbox.some((event) => event.topic === "PortfolioCreated")).toBe(true);
  });

  it("records transactions idempotently and rebuilds positions plus snapshots", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@example.com");

    const firstResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "fixed-key-001")
      .send({
        assetSymbol: "MSFT",
        assetName: "Microsoft",
        tradeDate: "2026-07-14",
        type: "buy",
        quantity: 5,
        unitPrice: 420,
        currency: "USD"
      });
    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "fixed-key-001")
      .send({
        assetSymbol: "MSFT",
        assetName: "Microsoft",
        tradeDate: "2026-07-14",
        type: "buy",
        quantity: 5,
        unitPrice: 420,
        currency: "USD"
      });
    expect(secondResponse.status).toBe(201);
    expect(secondResponse.body.data.id).toBe(firstResponse.body.data.id);

    const positionsResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/positions")
      .set("Authorization", `Bearer ${token}`);
    expect(positionsResponse.status).toBe(200);
    expect(positionsResponse.body.data.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetSymbol: "MSFT",
          quantity: 125
        })
      ])
    );

    const snapshotsResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/snapshots")
      .set("Authorization", `Bearer ${token}`);
    expect(snapshotsResponse.status).toBe(200);
    expect(snapshotsResponse.body.data.snapshots[0]).toHaveProperty("asOfDate");
  });

  it("rejects sell transactions that would create a negative position", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@example.com");

    const response = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assetSymbol: "MSFT",
        assetName: "Microsoft",
        tradeDate: "2026-07-14",
        type: "sell",
        quantity: 500,
        unitPrice: 420,
        currency: "USD"
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("portfolio.negative_position");
  });

  it("reconstructs positions for a selected date", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@example.com");

    const response = await request(app)
      .get("/api/v1/portfolios/prt_main/positions?asOf=2026-07-09")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.meta.asOf).toBe("2026-07-09");
    expect(response.body.data.positions).toEqual([
      expect.objectContaining({
        assetSymbol: "MSFT",
        quantity: 120
      })
    ]);
  });
});
