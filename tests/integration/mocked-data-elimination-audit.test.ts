import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSeededTestApp } from "../helpers/testApp";
import { createSeededIdentityStore } from "../helpers/seededIdentityStore";

describe("mocked data elimination audit", () => {
  it("does not seed historical local users during runtime app startup", async () => {
    const { app } = await createApp();

    const response = await request(app).post("/api/v1/auth/login").send({
      email: "user@risk.local",
      password: "Password123!"
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("auth.invalid_credentials");
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("keeps seeded records behind explicit test setup only", async () => {
    const { app } = await createSeededTestApp();

    const response = await request(app).post("/api/v1/auth/login").send({
      email: "user@risk.local",
      password: "Password123!"
    });

    expect(response.status).toBe(200);
    expect(response.body.data.actor).toMatchObject({
      email: "user@risk.local",
      role: "user"
    });
  });

  it("does not rewrite former fixture aliases to canonical seeded identities", async () => {
    const identityStore = await createSeededIdentityStore();

    await expect(identityStore.findByEmail("user@example.com")).resolves.toBeUndefined();
    await expect(identityStore.findByEmail("user@risk.local")).resolves.toMatchObject({
      id: "usr_user"
    });
  });
});
