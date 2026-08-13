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

describe("client portal report delivery", () => {
  it("lets staff create, approve, and deliver ready report packages", async () => {
    const { app } = await createApp();
    const advisorToken = await login(app, "advisor@example.com");
    const approverToken = await login(app, "user@risk.local");

    const createResponse = await request(app)
      .post("/api/v1/clients/client_main/report-packages")
      .set("Authorization", `Bearer ${advisorToken}`)
      .send({
        title: "Board-ready summary",
        summaryNotes: "Resumo somente leitura para a próxima revisão do cliente.",
        internalNotes: "Acompanhamento interno permanece restrito à equipe.",
        submitForApproval: true,
        items: [
          {
            type: "portfolio_summary",
            title: "Visão geral Core Growth",
            portfolioId: "prt_main",
            status: "ready"
          }
        ]
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.status).toBe("pending_approval");
    expect(createResponse.body.data.internalNotes).toBe(
      "Acompanhamento interno permanece restrito à equipe."
    );

    const deniedDelivery = await request(app)
      .post(`/api/v1/report-packages/${createResponse.body.data.id}/deliver`)
      .set("Authorization", `Bearer ${advisorToken}`);
    expect(deniedDelivery.status).toBe(403);
    expect(deniedDelivery.body.error.code).toBe("auth.permission_denied");

    const approveResponse = await request(app)
      .post(`/api/v1/report-packages/${createResponse.body.data.id}/approve`)
      .set("Authorization", `Bearer ${approverToken}`);
    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.data.status).toBe("approved");
    expect(approveResponse.body.data.approvedAt).toEqual(expect.any(String));

    const deliverResponse = await request(app)
      .post(`/api/v1/report-packages/${createResponse.body.data.id}/deliver`)
      .set("Authorization", `Bearer ${approverToken}`);
    expect(deliverResponse.status).toBe(200);
    expect(deliverResponse.body.data.status).toBe("delivered");

    const auditResponse = await request(app)
      .get("/api/v1/offices/ofc_main/audit-events")
      .query({ action: "report_package.delivered" })
      .set("Authorization", `Bearer ${approverToken}`);
    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.data.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: createResponse.body.data.id,
          clientId: "client_main"
        })
      ])
    );
  });

  it("blocks delivery until required package items are ready", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@risk.local");

    const approveResponse = await request(app)
      .post("/api/v1/report-packages/rpkg_pending_main/approve")
      .set("Authorization", `Bearer ${token}`);
    expect(approveResponse.status).toBe(200);

    const deliverResponse = await request(app)
      .post("/api/v1/report-packages/rpkg_pending_main/deliver")
      .set("Authorization", `Bearer ${token}`);
    expect(deliverResponse.status).toBe(400);
    expect(deliverResponse.body.error.code).toBe("report_package.items_not_ready");
  });

  it("returns read-only client portal packages without internal metadata", async () => {
    const { app } = await createApp();
    const clientToken = await login(app, "client@example.com");

    const portalResponse = await request(app)
      .get("/api/v1/client-portal")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(portalResponse.status).toBe(200);
    expect(portalResponse.body.data.clients).toEqual([
      expect.objectContaining({ id: "client_main" })
    ]);
    expect(portalResponse.body.data.packages).toEqual([
      expect.objectContaining({
        id: "rpkg_delivered_main",
        status: "viewed",
        title: "Resumo de risco de julho",
        portfolios: [expect.objectContaining({ id: "prt_main" })]
      })
    ]);
    expect(portalResponse.body.data.packages[0]).not.toHaveProperty("internalNotes");

    const detailResponse = await request(app)
      .get("/api/v1/report-packages/rpkg_delivered_main")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data).not.toHaveProperty("internalNotes");

    const crossClientResponse = await request(app)
      .get("/api/v1/report-packages/rpkg_private_delivered")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(crossClientResponse.status).toBe(403);
    expect(crossClientResponse.body.error.code).toBe("auth.permission_denied");
  });

  it("hides revoked packages from the client portal", async () => {
    const { app } = await createApp();
    const officeToken = await login(app, "user@risk.local");
    const clientToken = await login(app, "client@example.com");

    const revokeResponse = await request(app)
      .post("/api/v1/report-packages/rpkg_delivered_main/revoke")
      .set("Authorization", `Bearer ${officeToken}`);
    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.data.status).toBe("revoked");

    const portalResponse = await request(app)
      .get("/api/v1/client-portal")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(portalResponse.status).toBe(200);
    expect(portalResponse.body.data.packages).toEqual([]);
  });
});
