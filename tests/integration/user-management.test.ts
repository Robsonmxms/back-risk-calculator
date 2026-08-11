import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryIdentityStore } from "../../src/04-infra/repositories/InMemoryIdentityStore";
import { createSeededIdentityStore } from "../helpers/seededIdentityStore";
import { createSeededTestApp } from "../helpers/testApp";

describe("hierarchical user management", () => {
  let store: InMemoryIdentityStore;

  beforeEach(async () => {
    store = await createSeededIdentityStore();
  });

  it("lists exactly one authorized role with search, filters and standard pagination", async () => {
    const { app } = await createSeededTestApp({ identityStore: store });
    const token = await login(app, "admin@risk.local");

    const response = await request(app)
      .get("/api/v1/users")
      .query({ role: "user", search: "usuário", status: "active", page: 1, per_page: 1 })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ role: "user", status: "active" });
    expect(response.body.meta.pagination).toMatchObject({
      page: 1,
      per_page: 1,
      has_prev: false
    });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|googleSubject|refreshToken/);
  });

  it("enforces the list hierarchy and authentication without disclosing identities", async () => {
    const { app } = await createSeededTestApp({ identityStore: store });
    const analystToken = await login(app, "analyst@risk.local");
    const userToken = await login(app, "user@risk.local");

    const allowed = await request(app)
      .get("/api/v1/users?role=user")
      .set("Authorization", `Bearer ${analystToken}`);
    const forbiddenRole = await request(app)
      .get("/api/v1/users?role=analyst")
      .set("Authorization", `Bearer ${analystToken}`);
    const forbiddenManager = await request(app)
      .get("/api/v1/users?role=user")
      .set("Authorization", `Bearer ${userToken}`);
    const unauthenticated = await request(app).get("/api/v1/users?role=user");

    expect(allowed.status).toBe(200);
    expect(forbiddenRole.status).toBe(403);
    expect(forbiddenRole.body.error.code).toBe("user.target_role_forbidden");
    expect(forbiddenManager.status).toBe(403);
    expect(forbiddenManager.body.error.code).toBe("user.management_forbidden");
    expect(unauthenticated.status).toBe(401);
    expect(JSON.stringify(forbiddenRole.body)).not.toContain("analyst@risk.local");
  });

  it("creates safe users within scope and rejects escalation, conflicts and weak passwords", async () => {
    const { app, metrics } = await createSeededTestApp({ identityStore: store });
    const adminToken = await login(app, "admin@risk.local");
    const analystToken = await login(app, "analyst@risk.local");
    const initialPassword = "StrongPassword123!";

    const created = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${analystToken}`)
      .set("x-correlation-id", "create-user-test")
      .send({
        name: "Nova Pessoa",
        email: "New.User@Example.invalid",
        role: "user",
        status: "active",
        initialPassword
      });
    const escalation = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({
        name: "Analista Indevido",
        email: "forbidden@example.invalid",
        role: "analyst",
        status: "active",
        initialPassword
      });
    const duplicate = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Duplicado",
        email: "NEW.USER@example.invalid",
        role: "user",
        status: "active",
        initialPassword
      });
    const weak = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Senha Fraca",
        email: "weak@example.invalid",
        role: "user",
        status: "active",
        initialPassword: "weak"
      });

    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(`/api/v1/users/${created.body.data.id}`);
    expect(created.body.data).toMatchObject({
      email: "new.user@example.invalid",
      role: "user",
      status: "active"
    });
    expect(escalation.status).toBe(403);
    expect(escalation.body.error.code).toBe("user.target_role_forbidden");
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("user.email_conflict");
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("request.validation_failed");
    expect(
      JSON.stringify([created.body, store.outboxEvents, store.userManagementAuditEvents])
    ).not.toContain(initialPassword);
    expect(JSON.stringify(store.userManagementAuditEvents)).not.toContain(
      "new.user@example.invalid"
    );
    expect(metrics.snapshot()).toMatchObject({
      "user.management.create.success.actor_role.analyst": 1,
      "user.management.create.success.target_role.user": 1,
      "user.management.create.success.reason.user.create_succeeded": 1,
      "user.management.create.denied.reason.user.target_role_forbidden": 1,
      "user.management.create.conflict.reason.user.email_conflict": 1
    });
  });

  it("blocks self-management and analyst promotion while allowing safe partial edits", async () => {
    const { app } = await createSeededTestApp({ identityStore: store });
    const adminToken = await login(app, "admin@risk.local");
    const analystToken = await login(app, "analyst@risk.local");

    const self = await request(app)
      .patch("/api/v1/users/usr_admin")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Outro nome" });
    const promotion = await request(app)
      .patch("/api/v1/users/usr_user")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({ role: "analyst" });
    const updated = await request(app)
      .patch("/api/v1/users/usr_user")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({ name: "Nome Atualizado" });
    const unknownField = await request(app)
      .patch("/api/v1/users/usr_user")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ passwordHash: "crafted" });

    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("user.self_management_forbidden");
    expect(promotion.status).toBe(403);
    expect(promotion.body.error.code).toBe("user.resulting_role_forbidden");
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ id: "usr_user", name: "Nome Atualizado" });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.error.code).toBe("request.validation_failed");
  });

  it("revokes refresh sessions and current access after disablement", async () => {
    const { app } = await createSeededTestApp({ identityStore: store });
    const adminToken = await login(app, "admin@risk.local");
    const userSession = await loginSession(app, "user@risk.local");

    const disabled = await request(app)
      .patch("/api/v1/users/usr_user")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });
    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: userSession.refreshToken });
    const current = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${userSession.accessToken}`);
    const relogin = await request(app).post("/api/v1/auth/login").send({
      email: "user@risk.local",
      password: "Password123!"
    });

    expect(disabled.status).toBe(200);
    expect(refresh.status).toBe(401);
    expect(refresh.body.error.code).toBe("auth.refresh_revoked");
    expect(current.status).toBe(401);
    expect(current.body.error.code).toBe("auth.actor_not_found");
    expect(relogin.status).toBe(401);
  });

  it("revokes refresh sessions and publishes safe events after a role change", async () => {
    const { app } = await createSeededTestApp({ identityStore: store });
    const adminToken = await login(app, "admin@risk.local");
    const userSession = await loginSession(app, "user@risk.local");

    const changed = await request(app)
      .patch("/api/v1/users/usr_user")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "analyst" });
    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: userSession.refreshToken });
    const newlyAuthorized = await request(app)
      .get("/api/v1/users?role=user")
      .set("Authorization", `Bearer ${userSession.accessToken}`);

    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ id: "usr_user", role: "analyst" });
    expect(refresh.status).toBe(401);
    expect(refresh.body.error.code).toBe("auth.refresh_revoked");
    expect(newlyAuthorized.status).toBe(200);
    expect(store.outboxEvents.map((event) => event.topic)).toEqual(
      expect.arrayContaining(["user.updated", "user.role_changed"])
    );
    expect(
      [...store.userManagementAuditEvents].reverse().find((event) => event.action === "update")
    ).toMatchObject({
      targetId: "usr_user",
      targetRole: "user",
      resultingRole: "analyst",
      changedFields: ["role"],
      outcome: "success"
    });
    expect(JSON.stringify(store.outboxEvents)).not.toMatch(/password|token|email/i);
  });

  it("returns not found only within an authorized management flow and removes the legacy alias", async () => {
    const { app } = await createSeededTestApp({ identityStore: store });
    const adminToken = await login(app, "admin@risk.local");

    const missing = await request(app)
      .patch("/api/v1/users/usr_missing")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });
    const legacy = await request(app)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("user.not_found");
    expect(legacy.status).toBe(404);
    expect(legacy.body.error.code).toBe("request.route_not_found");
  });
});

async function login(app: Parameters<typeof request>[0], email: string): Promise<string> {
  return (await loginSession(app, email)).accessToken;
}

async function loginSession(
  app: Parameters<typeof request>[0],
  email: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });
  return response.body.data;
}
