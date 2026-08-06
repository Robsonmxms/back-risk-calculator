import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";
import { createSeededIdentityStore } from "../helpers/seededIdentityStore";

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
    const token = await login(app, "analyst@risk.local");

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
    const token = await login(app, "user@risk.local");

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
    const token = await login(app, "user@risk.local");

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

  it("rejects reused idempotency keys with a different transaction payload", async () => {
    const identityStore = await createSeededIdentityStore();
    const { app } = await createApp({ identityStore });
    const token = await login(app, "user@risk.local");

    const firstResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "mismatch-key-001")
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
    const outboxAfterFirstWrite = await identityStore.listOutboxEvents();

    const mismatchResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "mismatch-key-001")
      .send({
        assetSymbol: "AAPL",
        assetName: "Apple",
        tradeDate: "2026-07-14",
        type: "buy",
        quantity: 5,
        unitPrice: 210,
        currency: "USD"
      });

    expect(mismatchResponse.status).toBe(409);
    expect(mismatchResponse.body.error.code).toBe(
      "portfolio.idempotency_key_payload_mismatch"
    );
    await expect(identityStore.listOutboxEvents()).resolves.toHaveLength(
      outboxAfterFirstWrite.length
    );

    const transactionsResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`);
    expect(transactionsResponse.body.data.transactions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ assetSymbol: "AAPL" })])
    );
  });

  it("keeps missing idempotency keys non-idempotent", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@risk.local");
    const payload = {
      assetSymbol: "AMZN",
      assetName: "Amazon",
      tradeDate: "2026-07-14",
      type: "buy",
      quantity: 2,
      unitPrice: 190,
      currency: "USD"
    };

    const firstResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    const secondResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(secondResponse.body.data.id).not.toBe(firstResponse.body.data.id);
  });

  it("scopes idempotency keys to each portfolio", async () => {
    const { app } = await createApp();
    const adminToken = await login(app, "admin@risk.local");

    const mainResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "shared-portfolio-key")
      .send({
        assetSymbol: "AMZN",
        assetName: "Amazon",
        tradeDate: "2026-07-14",
        type: "buy",
        quantity: 2,
        unitPrice: 190,
        currency: "USD"
      });
    const incomeResponse = await request(app)
      .post("/api/v1/portfolios/prt_income/transactions")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "shared-portfolio-key")
      .send({
        assetSymbol: "SCHD",
        assetName: "Schwab US Dividend Equity ETF",
        tradeDate: "2026-07-14",
        type: "buy",
        quantity: 3,
        unitPrice: 106,
        currency: "USD"
      });

    expect(mainResponse.status).toBe(201);
    expect(incomeResponse.status).toBe(201);
    expect(incomeResponse.body.data.id).not.toBe(mainResponse.body.data.id);
  });

  it("rejects sell transactions that would create a negative position", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@risk.local");

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
    const token = await login(app, "user@risk.local");

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
