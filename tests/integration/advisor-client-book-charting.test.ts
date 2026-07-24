import request from "supertest";
import type { Response } from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";

async function login(app: Parameters<typeof request>[0], email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

function expectProtectedNoStore(response: Response) {
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers.pragma).toBe("no-cache");
  expect(response.headers.expires).toBe("0");
  expect(response.headers.vary).toContain("Authorization");
}

describe("advisor client book charting", () => {
  it("returns advisor-scoped chart sections without leaking unassigned clients", async () => {
    const { app } = await createApp();
    const advisorToken = await login(app, "advisor@example.com");
    const officeAdminToken = await login(app, "user@risk.local");

    await request(app)
      .post("/api/v1/offices/ofc_main/clients")
      .set("Authorization", `Bearer ${officeAdminToken}`)
      .send({
        name: "Confidential Prospect",
        email: "confidential.prospect@example.com",
        onboardingStatus: "invited",
        riskProfileDescriptor: "Perfil reservado"
      });

    const alertResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/alerts")
      .set("Authorization", `Bearer ${officeAdminToken}`)
      .send({
        title: "Review high drawdown before client conversation",
        severity: "high",
        condition: {
          eventType: "metric_threshold",
          metricKey: "maxDrawdown",
          operator: "gte",
          threshold: 8
        }
      });
    expect(alertResponse.status).toBe(201);

    const response = await request(app)
      .get("/api/v1/offices/ofc_main/advisor/charts?range=90d")
      .set("Authorization", `Bearer ${advisorToken}`);

    expect(response.status).toBe(200);
    expectProtectedNoStore(response);
    expect(response.body.meta.assignmentScope).toBe("advisor");
    expect(response.body.data.officeId).toBe("ofc_main");
    expect(response.body.data.advisorUserId).toBe("usr_advisor");
    expect(response.body.data.charts).toEqual(
      expect.objectContaining({
        bookValueTrend: expect.any(Array),
        riskReturnScatter: expect.any(Array),
        drawdownDistribution: expect.any(Array),
        volatilityDistribution: expect.any(Array),
        sectorExposureHeatmap: expect.any(Array),
        allocationBreakdown: expect.any(Array),
        alertSeverityTimeline: expect.any(Array),
        reportPipeline: expect.any(Array),
        workbenchAging: expect.any(Array),
        staleDataBacklog: expect.any(Array)
      })
    );
    expect(response.body.data.charts.riskReturnScatter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          portfolioId: "prt_main",
          clientId: "client_main",
          drillDown: expect.objectContaining({
            clientId: "client_main",
            portfolioId: "prt_main"
          })
        })
      ])
    );
    expect(response.body.data.charts.alertSeverityTimeline).toEqual(
      expect.arrayContaining([expect.objectContaining({ high: 1, total: 1 })])
    );
    expect(response.body.data.charts.reportPipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "delivered", count: 1 }),
        expect.objectContaining({ status: "pending_approval", count: 1 })
      ])
    );
    expect(response.body.data.rankings.needsAttention[0]).toEqual(
      expect.objectContaining({
        clientId: "client_main",
        drillDown: expect.objectContaining({ clientId: "client_main" })
      })
    );
    expect(JSON.stringify(response.body)).not.toContain("Confidential Prospect");
    expect(response.body.data.dataQuality.status).toMatch(/partial|fresh|stale/);
  });

  it("allows office admins to select an advisor and returns empty books without errors", async () => {
    const { app } = await createApp();
    const officeAdminToken = await login(app, "user@risk.local");

    const selectedAdvisor = await request(app)
      .get("/api/v1/offices/ofc_main/advisor/charts")
      .query({ advisorUserId: "usr_advisor", teamId: "team_core_main", clientStatus: "active" })
      .set("Authorization", `Bearer ${officeAdminToken}`);

    expect(selectedAdvisor.status).toBe(200);
    expectProtectedNoStore(selectedAdvisor);
    expect(selectedAdvisor.body.meta.assignmentScope).toBe("office_admin");
    expect(selectedAdvisor.body.data.advisorUserId).toBe("usr_advisor");
    expect(selectedAdvisor.body.data.dataQuality.sourceCounts.clients).toBeGreaterThanOrEqual(1);

    const emptyBook = await request(app)
      .get("/api/v1/offices/ofc_main/advisor/charts")
      .set("Authorization", `Bearer ${officeAdminToken}`);

    expect(emptyBook.status).toBe(200);
    expect(emptyBook.body.data.dataQuality.status).toBe("empty");
    expect(emptyBook.body.data.dataQuality.sourceCounts.clients).toBe(0);
    expect(emptyBook.body.data.charts.riskReturnScatter).toEqual([]);
  });

  it("denies ordinary advisors selecting another advisor and blocks client users", async () => {
    const { app } = await createApp();
    const advisorToken = await login(app, "advisor@example.com");
    const clientToken = await login(app, "client@example.com");

    const crossAdvisor = await request(app)
      .get("/api/v1/offices/ofc_main/advisor/charts")
      .query({ advisorUserId: "usr_user" })
      .set("Authorization", `Bearer ${advisorToken}`);
    expect(crossAdvisor.status).toBe(403);
    expect(crossAdvisor.body.error.code).toBe("auth.advisor_chart_scope_denied");
    expectProtectedNoStore(crossAdvisor);

    const clientResponse = await request(app)
      .get("/api/v1/offices/ofc_main/advisor/charts")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(clientResponse.status).toBe(403);
    expect(clientResponse.body.error.code).toBe("auth.permission_denied");
    expectProtectedNoStore(clientResponse);
  });
});
