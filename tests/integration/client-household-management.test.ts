import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";

async function login(app: Parameters<typeof request>[0], email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

describe("client household management", () => {
  it("lists clients with search and contract-backed filters", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@example.com");

    const searchResponse = await request(app)
      .get("/api/v1/offices/ofc_main/clients")
      .query({ search: "marina", status: "active" })
      .set("Authorization", `Bearer ${token}`);
    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.meta.count).toBe(1);
    expect(searchResponse.body.data.clients[0]).toMatchObject({
      id: "client_main",
      name: "Marina Silva",
      householdName: "Família Silva",
      advisorName: "Assessor",
      accountCount: 1,
      portfolioCount: 1
    });

    const householdResponse = await request(app)
      .get("/api/v1/offices/ofc_main/clients")
      .query({ householdId: "hh_main_silva" })
      .set("Authorization", `Bearer ${token}`);
    expect(householdResponse.status).toBe(200);
    expect(householdResponse.body.meta.count).toBe(2);
  });

  it("returns client detail with household, accounts, portfolios, and portfolio client links", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@example.com");

    const clientResponse = await request(app)
      .get("/api/v1/clients/client_main")
      .set("Authorization", `Bearer ${token}`);
    expect(clientResponse.status).toBe(200);
    expect(clientResponse.body.data).toMatchObject({
      id: "client_main",
      household: { id: "hh_main_silva", name: "Família Silva" },
      accounts: [expect.objectContaining({ id: "acct_main" })],
      portfolios: [
        expect.objectContaining({
          id: "prt_main",
          clientId: "client_main",
          clientName: "Marina Silva"
        })
      ]
    });

    const portfolioResponse = await request(app)
      .get("/api/v1/portfolios/prt_main")
      .set("Authorization", `Bearer ${token}`);
    expect(portfolioResponse.status).toBe(200);
    expect(portfolioResponse.body.data).toMatchObject({
      id: "prt_main",
      clientId: "client_main",
      clientName: "Marina Silva",
      householdName: "Família Silva"
    });
  });

  it("creates households and clients, then archives without deleting linked history", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@example.com");

    const householdResponse = await request(app)
      .post("/api/v1/offices/ofc_main/households")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "New Household" });
    expect(householdResponse.status).toBe(201);

    const clientResponse = await request(app)
      .post("/api/v1/offices/ofc_main/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        householdId: householdResponse.body.data.id,
        name: "Client Archive",
        email: "client.archive@example.com",
        onboardingStatus: "invited",
        advisorUserId: "usr_advisor",
        riskProfileDescriptor: "Liquidity reserve profile"
      });
    expect(clientResponse.status).toBe(201);
    expect(clientResponse.body.data).toMatchObject({
      name: "Client Archive",
      status: "active",
      onboardingStatus: "invited"
    });

    const archivedResponse = await request(app)
      .patch(`/api/v1/clients/${clientResponse.body.data.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "archived", notes: "Relationship paused." });
    expect(archivedResponse.status).toBe(200);
    expect(archivedResponse.body.data.status).toBe("archived");
    expect(archivedResponse.body.data.archivedAt).toEqual(expect.any(String));

    const detailResponse = await request(app)
      .get(`/api/v1/clients/${clientResponse.body.data.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.status).toBe("archived");
    expect(detailResponse.body.data.accounts).toEqual([]);
  });

  it("denies cross-office client reads and mutations without client management permission", async () => {
    const { app } = await createApp();
    const officeToken = await login(app, "user@example.com");
    const assistantToken = await login(app, "assistant@example.com");

    const crossOfficeResponse = await request(app)
      .get("/api/v1/clients/client_private")
      .set("Authorization", `Bearer ${officeToken}`);
    expect(crossOfficeResponse.status).toBe(403);
    expect(crossOfficeResponse.body.error.code).toBe("auth.office_access_denied");

    const deniedCreate = await request(app)
      .post("/api/v1/offices/ofc_main/clients")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({
        name: "Assistant Created",
        email: "assistant.created@example.com"
      });
    expect(deniedCreate.status).toBe(403);
    expect(deniedCreate.body.error.code).toBe("auth.permission_denied");
  });

  it("limits client-like viewers to explicitly assigned client records", async () => {
    const { app } = await createApp();
    const token = await login(app, "client@example.com");

    const listResponse = await request(app)
      .get("/api/v1/offices/ofc_main/clients")
      .set("Authorization", `Bearer ${token}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.clients).toEqual([
      expect.objectContaining({ id: "client_main" })
    ]);

    const deniedDetail = await request(app)
      .get("/api/v1/clients/client_spouse")
      .set("Authorization", `Bearer ${token}`);
    expect(deniedDetail.status).toBe(403);
    expect(deniedDetail.body.error.code).toBe("auth.permission_denied");
  });
});
