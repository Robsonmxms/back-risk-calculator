import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";

async function login(app: Parameters<typeof request>[0], email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

describe("advisory team permissions", () => {
  it("returns the office permission matrix for the authenticated actor", async () => {
    const { app } = await createApp();
    const token = await login(app, "analyst@risk.local");

    const response = await request(app)
      .get("/api/v1/me/permissions")
      .query({ officeId: "ofc_main" })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe("analyst");
    expect(response.body.data.permissions).toEqual(
      expect.arrayContaining(["analytics.read", "analytics.recompute", "ledger.read"])
    );
    expect(response.body.data.permissions).not.toContain("ledger.write");
    expect(response.body.data.matrix.office_admin).toEqual(
      expect.arrayContaining(["office.members.manage", "audit.read"])
    );
  });

  it("allows office admins to manage teams and assignments", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@risk.local");

    const teamResponse = await request(app)
      .post("/api/v1/offices/ofc_main/teams")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Planning Desk",
        description: "Client planning coverage",
        memberUserIds: ["usr_advisor", "usr_assistant"]
      });

    expect(teamResponse.status).toBe(201);
    expect(teamResponse.body.data).toMatchObject({
      officeId: "ofc_main",
      name: "Planning Desk",
      status: "active"
    });
    expect(teamResponse.body.data.members).toHaveLength(2);

    const listResponse = await request(app)
      .get("/api/v1/offices/ofc_main/teams")
      .set("Authorization", `Bearer ${token}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.teams).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Planning Desk" })])
    );

    const assignmentResponse = await request(app)
      .post("/api/v1/clients/client_main/assignments")
      .set("Authorization", `Bearer ${token}`)
      .send({
        officeId: "ofc_main",
        teamId: teamResponse.body.data.id,
        resourceType: "portfolio",
        resourceId: "prt_main",
        permissions: ["ledger.write"]
      });

    expect(assignmentResponse.status).toBe(201);
    expect(assignmentResponse.body.data).toMatchObject({
      officeId: "ofc_main",
      resourceType: "portfolio",
      resourceId: "prt_main",
      teamId: teamResponse.body.data.id,
      permissions: ["ledger.write"]
    });

    const assignmentsResponse = await request(app)
      .get("/api/v1/offices/ofc_main/assignments")
      .set("Authorization", `Bearer ${token}`);
    expect(assignmentsResponse.body.data.assignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: assignmentResponse.body.data.id })])
    );

    const deleteResponse = await request(app)
      .delete(`/api/v1/assignments/${assignmentResponse.body.data.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.data.revokedAt).toEqual(expect.any(String));
  });

  it("denies team management outside office member management permission", async () => {
    const { app } = await createApp();
    const analystToken = await login(app, "analyst@risk.local");
    const userToken = await login(app, "user@risk.local");

    const deniedByRole = await request(app)
      .post("/api/v1/offices/ofc_main/teams")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({ name: "Analyst Managed Team", memberUserIds: ["usr_analyst"] });
    expect(deniedByRole.status).toBe(403);
    expect(deniedByRole.body.error.code).toBe("auth.permission_denied");

    const deniedByOffice = await request(app)
      .get("/api/v1/offices/ofc_private/teams")
      .set("Authorization", `Bearer ${userToken}`);
    expect(deniedByOffice.status).toBe(403);
    expect(deniedByOffice.body.error.code).toBe("auth.office_access_denied");
  });

  it("blocks analyst ledger writes until an explicit portfolio assignment grants them", async () => {
    const { app } = await createApp();
    const officeAdminToken = await login(app, "user@risk.local");
    const analystToken = await login(app, "analyst@risk.local");

    const deniedWrite = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({
        assetSymbol: "MSFT",
        assetName: "Microsoft",
        tradeDate: "2026-07-14",
        type: "buy",
        quantity: 1,
        unitPrice: 420,
        currency: "USD"
      });
    expect(deniedWrite.status).toBe(403);
    expect(deniedWrite.body.error.code).toBe("auth.permission_denied");

    const assignmentResponse = await request(app)
      .post("/api/v1/clients/client_main/assignments")
      .set("Authorization", `Bearer ${officeAdminToken}`)
      .send({
        officeId: "ofc_main",
        assigneeUserId: "usr_analyst",
        resourceType: "portfolio",
        resourceId: "prt_main",
        permissions: ["ledger.write"]
      });
    expect(assignmentResponse.status).toBe(201);

    const allowedWrite = await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({
        assetSymbol: "MSFT",
        assetName: "Microsoft",
        tradeDate: "2026-07-15",
        type: "buy",
        quantity: 1,
        unitPrice: 421,
        currency: "USD"
      });
    expect(allowedWrite.status).toBe(201);
    expect(allowedWrite.body.data.assetSymbol).toBe("MSFT");
  });
});
