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

describe("office admin operational charting", () => {
  it("returns office-scoped operational chart sections with safe drill-down ids", async () => {
    const { app, reportsAlerts } = await createApp({
      reportsAlerts: { reportsAlertsNow: () => new Date("2026-07-15T12:00:00.000Z") },
      operationalCharts: {
        operationalChartsNow: () => new Date("2026-07-15T12:00:00.000Z")
      }
    });
    const officeAdminToken = await login(app, "user@risk.local");

    await request(app)
      .post("/api/v1/portfolios/prt_main/alerts")
      .set("Authorization", `Bearer ${officeAdminToken}`)
      .send({
        title: "Concentração em acompanhamento operacional",
        severity: "high",
        condition: {
          eventType: "metric_threshold",
          metricKey: "maxDrawdown",
          operator: "gte",
          threshold: 8
        }
      });
    await request(app)
      .post("/api/v1/portfolios/prt_main/reports")
      .set("Authorization", `Bearer ${officeAdminToken}`)
      .send({ format: "pdf" });
    await reportsAlerts.reportWorker.processNext();

    const response = await request(app)
      .get("/api/v1/offices/ofc_main/admin/charts")
      .query({ range: "30d", severity: "high" })
      .set("Authorization", `Bearer ${officeAdminToken}`);

    expect(response.status).toBe(200);
    expectProtectedNoStore(response);
    expect(response.body.meta.generatedAt).toEqual(expect.any(String));
    expect(response.body.data).toMatchObject({
      officeId: "ofc_main",
      range: "30d",
      charts: {
        clientGrowth: expect.any(Array),
        onboardingFunnel: expect.any(Array),
        staffRoleDistribution: expect.any(Array),
        assignmentLoad: expect.any(Array),
        portfolioCoverage: expect.any(Array),
        assetCoverage: expect.any(Array),
        marketDataFreshness: expect.any(Array),
        analyticsQueueHealth: expect.any(Array),
        reportThroughput: expect.any(Array),
        reportFailures: expect.any(Array),
        alertNotificationVolume: expect.any(Array),
        permissionActivity: expect.any(Array)
      }
    });
    expect(response.body.data.dataQuality.sourceCounts.clients).toBeGreaterThanOrEqual(3);
    expect(response.body.data.dataQuality.sourceCounts.portfolios).toBe(1);
    expect(response.body.data.charts.onboardingFunnel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "complete",
          clientIds: expect.arrayContaining(["client_main"])
        })
      ])
    );
    expect(response.body.data.charts.assetCoverage).toEqual(
      expect.arrayContaining([expect.objectContaining({ assetSymbol: "MSFT" })])
    );
    expect(response.body.data.charts.reportThroughput).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "ready", count: 1 })])
    );
    expect(response.body.data.charts.alertNotificationVolume).toEqual(
      expect.arrayContaining([expect.objectContaining({ high: 1, total: 1 })])
    );
    expect(JSON.stringify(response.body)).not.toContain("client_private");
    expect(JSON.stringify(response.body)).not.toContain("private.client@example.com");
    expect(JSON.stringify(response.body)).not.toMatch(/token|secret|credential|password/i);
  });

  it("keeps office admins inside their tenant and blocks non-admin office members", async () => {
    const { app } = await createApp({
      operationalCharts: {
        operationalChartsNow: () => new Date("2026-07-15T12:00:00.000Z")
      }
    });
    const mainOfficeAdminToken = await login(app, "user@risk.local");
    const advisorToken = await login(app, "advisor@example.com");

    const crossOffice = await request(app)
      .get("/api/v1/offices/ofc_private/admin/charts")
      .set("Authorization", `Bearer ${mainOfficeAdminToken}`);
    expect(crossOffice.status).toBe(403);
    expect(crossOffice.body.error.code).toBe("auth.office_access_denied");
    expectProtectedNoStore(crossOffice);

    const advisorResponse = await request(app)
      .get("/api/v1/offices/ofc_main/admin/charts")
      .set("Authorization", `Bearer ${advisorToken}`);
    expect(advisorResponse.status).toBe(403);
    expect(advisorResponse.body.error.code).toBe("auth.office_admin_chart_scope_denied");
    expectProtectedNoStore(advisorResponse);
  });

  it("returns platform charts only for global admins without tenant drill-down data", async () => {
    const { app } = await createApp({
      operationalCharts: {
        operationalChartsNow: () => new Date("2026-07-15T12:00:00.000Z")
      }
    });
    const adminToken = await login(app, "admin@risk.local");
    const officeAdminToken = await login(app, "user@risk.local");

    const denied = await request(app)
      .get("/api/v1/admin/platform/charts")
      .set("Authorization", `Bearer ${officeAdminToken}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("auth.platform_chart_scope_denied");
    expectProtectedNoStore(denied);

    const response = await request(app)
      .get("/api/v1/admin/platform/charts")
      .query({ range: "90d" })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expectProtectedNoStore(response);
    expect(response.body.data.platformId).toBe("global");
    expect(response.body.data.charts.officeStatusDistribution).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "active", count: 2 })])
    );
    expect(response.body.data.charts.officeVolume).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket: "offices", count: 2 }),
        expect.objectContaining({ bucket: "clients", count: 4 })
      ])
    );
    expect(JSON.stringify(response.body)).not.toContain("client_main");
    expect(JSON.stringify(response.body)).not.toContain("Cliente Reservado");
  });
});
