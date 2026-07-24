import request from "supertest";
import type { Response } from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";

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

describe("compliance and delivery charting", () => {
  it("returns compliance chart sections with redacted drill-down data for audit readers", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@risk.local");

    const response = await request(app)
      .get("/api/v1/offices/ofc_main/compliance/charts")
      .query({ range: "all", severity: "critical" })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expectProtectedNoStore(response);
    expect(response.body.meta.generatedAt).toEqual(expect.any(String));
    expect(response.body.data).toMatchObject({
      officeId: "ofc_main",
      range: "all",
      charts: {
        auditEventTimeline: expect.any(Array),
        auditActionBreakdown: expect.any(Array),
        reviewStatusFunnel: expect.any(Array),
        reviewAging: expect.any(Array),
        permissionActivity: expect.any(Array),
        exceptionHeatmap: expect.any(Array)
      }
    });
    expect(response.body.data.charts.auditActionBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delivery.report.failed",
          resourceType: "delivery",
          severity: "critical",
          eventIds: ["aud_report_delivery_failed"]
        })
      ])
    );
    expect(response.body.data.charts.reviewAging).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reviewIds: expect.arrayContaining(["sv_aud_report_delivery_failed"])
        })
      ])
    );
    expect(JSON.stringify(response.body)).not.toMatch(/token|secret|credential|password|phone|email/i);
  });

  it("denies compliance charts without audit read permission", async () => {
    const { app } = await createApp();
    const advisorToken = await login(app, "advisor@example.com");

    const response = await request(app)
      .get("/api/v1/offices/ofc_main/compliance/charts")
      .set("Authorization", `Bearer ${advisorToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("auth.permission_denied");
    expectProtectedNoStore(response);
  });

  it("returns delivery charts for staff with report scope and notification outcomes", async () => {
    const { app, reportsAlerts } = await createApp({
      reportsAlerts: { reportsAlertsNow: () => new Date("2026-07-15T12:00:00.000Z") }
    });
    const officeAdminToken = await login(app, "user@risk.local");

    await request(app)
      .post("/api/v1/portfolios/prt_main/reports")
      .set("Authorization", `Bearer ${officeAdminToken}`)
      .send({ format: "pdf" });
    await reportsAlerts.reportWorker.processNext();

    const response = await request(app)
      .get("/api/v1/offices/ofc_main/delivery/charts")
      .query({ range: "all" })
      .set("Authorization", `Bearer ${officeAdminToken}`);

    expect(response.status).toBe(200);
    expectProtectedNoStore(response);
    expect(response.body.data.charts.reportLifecycleFunnel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "delivered",
          reportPackageIds: expect.arrayContaining(["rpkg_delivered_main"])
        }),
        expect.objectContaining({
          status: "pending_approval",
          reportPackageIds: expect.arrayContaining(["rpkg_pending_main"])
        })
      ])
    );
    expect(response.body.data.charts.failureReasonBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureCode: "delivery_timeout",
          channel: "portal",
          eventIds: ["aud_report_delivery_failed"]
        })
      ])
    );
    expect(response.body.data.charts.notificationReadStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "unread",
          count: 1
        })
      ])
    );
    expect(response.body.data.charts.clientPackageReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: "client_main",
          clientName: "Marina Silva",
          reportPackageIds: expect.arrayContaining(["rpkg_delivered_main", "rpkg_pending_main"])
        })
      ])
    );
    expect(JSON.stringify(response.body)).not.toContain("client_private");
    expect(JSON.stringify(response.body)).not.toMatch(/private.client|internalNotes|password|token/i);
  });

  it("limits assistant delivery charts to assigned client scope and blocks client actors", async () => {
    const { app } = await createApp();
    const advisorToken = await login(app, "advisor@example.com");
    const analystToken = await login(app, "analyst@example.com");
    const assistantToken = await login(app, "assistant@example.com");
    const clientToken = await login(app, "client@example.com");

    for (const scopedStaffToken of [advisorToken, analystToken]) {
      const scopedStaffResponse = await request(app)
        .get("/api/v1/offices/ofc_main/delivery/charts")
        .query({ range: "all" })
        .set("Authorization", `Bearer ${scopedStaffToken}`);
      expect(scopedStaffResponse.status).toBe(200);
      expect(scopedStaffResponse.body.data.dataQuality.sourceCounts.clients).toBe(1);
      expect(JSON.stringify(scopedStaffResponse.body)).not.toContain("client_private");
    }

    const assistantResponse = await request(app)
      .get("/api/v1/offices/ofc_main/delivery/charts")
      .query({ range: "all" })
      .set("Authorization", `Bearer ${assistantToken}`);

    expect(assistantResponse.status).toBe(200);
    expect(assistantResponse.body.data.dataQuality.status).toBe("partial");
    expect(assistantResponse.body.data.dataQuality.sourceCounts.clients).toBe(1);
    expect(assistantResponse.body.data.charts.clientPackageReadiness).toEqual(
      expect.arrayContaining([expect.objectContaining({ clientId: "client_main" })])
    );
    expect(JSON.stringify(assistantResponse.body)).not.toContain("client_spouse");
    expect(JSON.stringify(assistantResponse.body)).not.toContain("client_private");

    const clientResponse = await request(app)
      .get("/api/v1/offices/ofc_main/delivery/charts")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(clientResponse.status).toBe(403);
    expect(clientResponse.body.error.code).toBe("auth.delivery_chart_scope_denied");
    expectProtectedNoStore(clientResponse);
  });
});
