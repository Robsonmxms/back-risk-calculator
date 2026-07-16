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

describe("advisor analyst workbench", () => {
  it("aggregates staff workbench sections for an office", async () => {
    const { app } = await createApp();
    const token = await login(app, "advisor@example.com");

    const response = await request(app)
      .get("/api/v1/offices/ofc_main/workbench")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.assignedClients).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "client_main" })])
    );
    expect(response.body.data.reviewItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "rev_main_report" })])
    );
    expect(response.body.data.counts.openReviewItems).toBeGreaterThanOrEqual(1);
  });

  it("filters review items and completes lifecycle updates", async () => {
    const { app } = await createApp();
    const token = await login(app, "advisor@example.com");

    const createResponse = await request(app)
      .post("/api/v1/offices/ofc_main/review-items")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Check analytics assumptions",
        severity: "high",
        resourceType: "client",
        resourceId: "client_main",
        clientId: "client_main",
        assignedToUserId: "usr_analyst",
        dueDate: "2026-07-21"
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.status).toBe("open");

    const filteredResponse = await request(app)
      .get("/api/v1/offices/ofc_main/review-items")
      .query({ severity: "high", assignedToUserId: "usr_analyst" })
      .set("Authorization", `Bearer ${token}`);
    expect(filteredResponse.status).toBe(200);
    expect(filteredResponse.body.data.reviewItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createResponse.body.data.id })])
    );

    const closedResponse = await request(app)
      .patch(`/api/v1/review-items/${createResponse.body.data.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "closed", notes: "Reviewed with analyst." });
    expect(closedResponse.status).toBe(200);
    expect(closedResponse.body.data.status).toBe("closed");
    expect(closedResponse.body.data.closedAt).toEqual(expect.any(String));
  });

  it("keeps review items isolated by office and assignment", async () => {
    const { app } = await createApp();
    const clientToken = await login(app, "client@example.com");
    const userToken = await login(app, "user@example.com");

    const clientWorkbench = await request(app)
      .get("/api/v1/offices/ofc_main/workbench")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(clientWorkbench.status).toBe(200);
    expect(clientWorkbench.body.data.assignedClients).toEqual([
      expect.objectContaining({ id: "client_main" })
    ]);
    expect(clientWorkbench.body.data.reviewItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ clientId: "client_main" })])
    );

    const crossOfficeResponse = await request(app)
      .get("/api/v1/offices/ofc_private/workbench")
      .set("Authorization", `Bearer ${userToken}`);
    expect(crossOfficeResponse.status).toBe(403);
    expect(crossOfficeResponse.body.error.code).toBe("auth.office_access_denied");
  });
});
