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

describe("compliance audit supervision", () => {
  it("lists paginated audit events with office-scoped filters and safe metadata", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@example.com");

    const response = await request(app)
      .get("/api/v1/offices/ofc_main/audit-events")
      .query({ severity: "critical", outcome: "failure", page: 1, pageSize: 5 })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ total: 1, page: 1, pageSize: 5 });
    expect(response.body.data.auditEvents).toEqual([
      expect.objectContaining({
        id: "aud_report_delivery_failed",
        action: "delivery.report.failed",
        resourceType: "delivery",
        outcome: "failure",
        severity: "critical",
        reviewRequired: true
      })
    ]);
    expect(Object.keys(response.body.data.auditEvents[0].metadata)).not.toEqual(
      expect.arrayContaining(["token", "password", "credential", "phone"])
    );
  });

  it("denies audit access without audit read permission or office membership", async () => {
    const { app } = await createApp();
    const advisorToken = await login(app, "advisor@example.com");
    const officeToken = await login(app, "user@example.com");

    const permissionDenied = await request(app)
      .get("/api/v1/offices/ofc_main/audit-events")
      .set("Authorization", `Bearer ${advisorToken}`);
    expect(permissionDenied.status).toBe(403);
    expect(permissionDenied.body.error.code).toBe("auth.permission_denied");

    const crossOfficeDenied = await request(app)
      .get("/api/v1/audit-events/aud_private_market_data")
      .set("Authorization", `Bearer ${officeToken}`);
    expect(crossOfficeDenied.status).toBe(403);
    expect(crossOfficeDenied.body.error.code).toBe("auth.office_access_denied");
  });

  it("updates supervision reviews and audits the review update", async () => {
    const { app, metrics } = await createApp();
    const token = await login(app, "user@example.com");

    const queueResponse = await request(app)
      .get("/api/v1/offices/ofc_main/supervision-reviews")
      .query({ status: "open" })
      .set("Authorization", `Bearer ${token}`);
    expect(queueResponse.status).toBe(200);
    expect(queueResponse.body.data.supervisionReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sv_aud_report_delivery_failed", severity: "critical" })
      ])
    );

    const updateResponse = await request(app)
      .patch("/api/v1/supervision-reviews/sv_aud_report_delivery_failed")
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "resolved",
        resolutionComment: "Delivery failure reviewed and client notice confirmed."
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data).toMatchObject({
      id: "sv_aud_report_delivery_failed",
      status: "resolved",
      resolutionComment: "Delivery failure reviewed and client notice confirmed."
    });
    expect(updateResponse.body.data.resolvedAt).toEqual(expect.any(String));

    const auditResponse = await request(app)
      .get("/api/v1/offices/ofc_main/audit-events")
      .query({ action: "supervision.review.updated" })
      .set("Authorization", `Bearer ${token}`);
    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.data.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "supervision.review.updated",
          resourceId: "sv_aud_report_delivery_failed"
        })
      ])
    );
    expect(metrics.snapshot()).toMatchObject({
      audit_events_written: 1,
      supervision_reviews_updated: 1
    });
  });

  it("creates immediate audit export jobs and records export audit events", async () => {
    const { app, metrics } = await createApp();
    const token = await login(app, "user@example.com");

    const exportResponse = await request(app)
      .post("/api/v1/offices/ofc_main/audit-exports")
      .set("Authorization", `Bearer ${token}`)
      .send({
        format: "csv",
        filters: { resourceType: "client" }
      });
    expect(exportResponse.status).toBe(202);
    expect(exportResponse.body.data).toMatchObject({
      officeId: "ofc_main",
      requestedBy: "usr_user",
      format: "csv",
      status: "completed",
      eventCount: 1
    });
    expect(exportResponse.body.data.downloadUrl).toContain("/audit-exports/");

    const auditResponse = await request(app)
      .get("/api/v1/offices/ofc_main/audit-events")
      .query({ action: "audit.export.requested" })
      .set("Authorization", `Bearer ${token}`);
    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.data.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "audit.export.requested", resourceType: "office" })
      ])
    );
    expect(metrics.snapshot()).toMatchObject({
      audit_exports_requested: 1,
      audit_events_written: 1
    });
  });
});
