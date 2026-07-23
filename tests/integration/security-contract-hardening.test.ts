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
  expect(response.headers.etag).toBeUndefined();
}

describe("security contract hardening", () => {
  it("returns deliberate no-store headers on representative protected JSON endpoints", async () => {
    const { app } = await createApp();
    const adminToken = await login(app, "admin@example.com");
    const userToken = await login(app, "user@example.com");

    const protectedEndpoints = [
      { path: "/api/v1/users/me", token: userToken },
      { path: "/api/v1/admin/users", token: adminToken },
      { path: "/api/v1/portfolios", token: userToken },
      { path: "/api/v1/portfolios/prt_main", token: userToken },
      { path: "/api/v1/portfolios/prt_main/analytics", token: userToken },
      { path: "/api/v1/portfolios/prt_main/reports", token: userToken },
      { path: "/api/v1/notifications", token: userToken },
      { path: "/api/v1/offices/ofc_main/clients", token: userToken },
      { path: "/api/v1/offices/ofc_main/workbench", token: userToken },
      { path: "/api/v1/offices/ofc_main/audit-events", token: userToken },
      { path: "/api/v1/offices/ofc_main/supervision-reviews", token: userToken },
      { path: "/api/v1/market-data/exchanges", token: userToken }
    ];

    for (const endpoint of protectedEndpoints) {
      const response = await request(app)
        .get(endpoint.path)
        .set("Authorization", `Bearer ${endpoint.token}`);

      expect(response.status, endpoint.path).toBe(200);
      expectProtectedNoStore(response);
    }
  });

  it("does not return 304 for protected JSON conditional requests", async () => {
    const { app } = await createApp();
    const userToken = await login(app, "user@example.com");

    const response = await request(app)
      .get("/api/v1/portfolios/prt_main/positions")
      .set("Authorization", `Bearer ${userToken}`)
      .set("If-None-Match", 'W/"protected-cache-test"');

    expect(response.status).toBe(200);
    expectProtectedNoStore(response);
  });

  it("keeps stable no-store error envelopes for protected authorization failures", async () => {
    const { app } = await createApp();
    const userToken = await login(app, "user@example.com");

    const response = await request(app)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${userToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("auth.forbidden");
    expectProtectedNoStore(response);
  });
});
