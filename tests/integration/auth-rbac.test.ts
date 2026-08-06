import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";

async function login(email: string) {
  const { app } = await createApp();
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });
  return { app, response };
}

describe("auth and RBAC", () => {
  it("returns an auth session for valid credentials", async () => {
    const { response } = await login("user@risk.local");

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(response.body.data.actor).toMatchObject({
      email: "user@risk.local",
      role: "user"
    });
    expect(response.body.data.actor.passwordHash).toBeUndefined();
  });

  it("keeps legacy local example.com credentials working as aliases", async () => {
    const { response } = await login("user@risk.local");

    expect(response.status).toBe(200);
    expect(response.body.data.actor).toMatchObject({
      email: "user@risk.local",
      role: "user"
    });
  });

  it("returns a stable safe error for invalid credentials", async () => {
    const { app } = await createApp();
    const response = await request(app).post("/api/v1/auth/login").send({
      email: "user@risk.local",
      password: "wrong-password"
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("auth.invalid_credentials");
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("does not expose the removed Google authentication route", async () => {
    const { app } = await createApp();
    const response = await request(app).post("/api/v1/auth/google").send({
      idToken: "legacy-google-token"
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "request.route_not_found",
        message: "Route not found"
      }
    });
    expect(JSON.stringify(response.body)).not.toMatch(/accessToken|refreshToken/);
  });

  it("rotates refresh tokens and revokes the family when a rotated token is reused", async () => {
    const { app, response: loginResponse } = await login("user@risk.local");
    const firstRefreshToken = loginResponse.body.data.refreshToken;

    const refreshResponse = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: firstRefreshToken
    });
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.data.refreshToken).not.toBe(firstRefreshToken);

    const reuseResponse = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: firstRefreshToken
    });
    expect(reuseResponse.status).toBe(401);
    expect(reuseResponse.body.error.code).toBe("auth.refresh_reused");

    const familyRevokedResponse = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: refreshResponse.body.data.refreshToken
    });
    expect(familyRevokedResponse.status).toBe(401);
    expect(familyRevokedResponse.body.error.code).toBe("auth.refresh_revoked");
  });

  it("revokes the active refresh token on logout", async () => {
    const { app, response: loginResponse } = await login("user@risk.local");
    const { accessToken, refreshToken } = loginResponse.body.data;

    const logoutResponse = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ refreshToken });
    expect(logoutResponse.status).toBe(204);

    const refreshResponse = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken
    });
    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.body.error.code).toBe("auth.refresh_revoked");
  });

  it("returns the current actor without sensitive fields", async () => {
    const { app, response: loginResponse } = await login("analyst@risk.local");

    const response = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${loginResponse.body.data.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.actor).toMatchObject({
      email: "analyst@risk.local",
      role: "analyst"
    });
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it("forbids non-admin actors from admin operations", async () => {
    const { app, response: loginResponse } = await login("user@risk.local");

    const response = await request(app)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${loginResponse.body.data.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("auth.forbidden");
  });

  it("allows assigned analysts and blocks analysts without account access", async () => {
    const { app, response: loginResponse } = await login("analyst@risk.local");
    const token = loginResponse.body.data.accessToken;

    const allowedResponse = await request(app)
      .get("/api/v1/accounts/acct_main/analytics/summary")
      .set("Authorization", `Bearer ${token}`);
    expect(allowedResponse.status).toBe(200);

    const deniedResponse = await request(app)
      .get("/api/v1/accounts/acct_private/analytics/summary")
      .set("Authorization", `Bearer ${token}`);
    expect(deniedResponse.status).toBe(403);
    expect(deniedResponse.body.error.code).toBe("auth.account_access_denied");
  });

  it("lists portfolio workspaces for the authenticated actor", async () => {
    const { app, response: loginResponse } = await login("analyst@risk.local");

    const response = await request(app)
      .get("/api/v1/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.data.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.meta.count).toBe(2);
    expect(response.body.data.portfolios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: "acct_main",
          membershipRole: "analyst",
          freshness: "stale",
          status: "degraded"
        }),
        expect.objectContaining({
          accountId: "acct_income",
          freshness: "stale",
          status: "degraded"
        })
      ])
    );
  });

  it("returns a portfolio dashboard with freshness metadata", async () => {
    const { app, response: loginResponse } = await login("analyst@risk.local");

    const response = await request(app)
      .get("/api/v1/accounts/acct_income/dashboard")
      .set("Authorization", `Bearer ${loginResponse.body.data.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({
      freshness: "stale",
      status: "degraded"
    });
    expect(response.body.data).toMatchObject({
      accountId: "acct_income",
      accountName: "Carteira de Renda",
      membershipRole: "analyst"
    });
    expect(response.body.data.holdings).toHaveLength(3);
    expect(response.body.data.transactions[0]).toHaveProperty("status");
  });
});
