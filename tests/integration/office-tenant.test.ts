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

describe("office tenant model", () => {
  it("adds office memberships to the authenticated actor", async () => {
    const { app } = await createApp();
    const token = await login(app, "user@example.com");

    const response = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.actor.officeMemberships).toEqual([
      {
        officeId: "ofc_main",
        officeName: "Orion Advisory",
        role: "office_admin"
      }
    ]);
  });

  it("lists visible offices and keeps tenant metadata isolated", async () => {
    const { app } = await createApp();
    const userToken = await login(app, "user@example.com");
    const adminToken = await login(app, "admin@example.com");

    const userResponse = await request(app)
      .get("/api/v1/offices")
      .set("Authorization", `Bearer ${userToken}`);
    expect(userResponse.status).toBe(200);
    expect(userResponse.body.data.offices).toEqual([
      expect.objectContaining({
        officeId: "ofc_main",
        officeName: "Orion Advisory"
      })
    ]);

    const adminResponse = await request(app)
      .get("/api/v1/offices")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.data.offices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ officeId: "ofc_main" }),
        expect.objectContaining({ officeId: "ofc_private" })
      ])
    );
  });

  it("denies cross-office office and portfolio access", async () => {
    const { app } = await createApp();
    const userToken = await login(app, "user@example.com");

    const officeResponse = await request(app)
      .get("/api/v1/offices/ofc_private")
      .set("Authorization", `Bearer ${userToken}`);
    expect(officeResponse.status).toBe(403);
    expect(officeResponse.body.error.code).toBe("auth.office_access_denied");

    const portfolioResponse = await request(app)
      .get("/api/v1/portfolios/prt_income")
      .set("Authorization", `Bearer ${userToken}`);
    expect(portfolioResponse.status).toBe(403);
    expect(portfolioResponse.body.error.code).toBe("auth.office_access_denied");
  });

  it("allows office admins to inspect members and update office settings", async () => {
    const { app } = await createApp();
    const userToken = await login(app, "user@example.com");
    const analystToken = await login(app, "analyst@example.com");

    const membersResponse = await request(app)
      .get("/api/v1/offices/ofc_main/members")
      .set("Authorization", `Bearer ${userToken}`);
    expect(membersResponse.status).toBe(200);
    expect(membersResponse.body.data.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "usr_user",
          role: "office_admin"
        }),
        expect.objectContaining({
          userId: "usr_analyst",
          role: "analyst"
        })
      ])
    );

    const deniedMembersResponse = await request(app)
      .get("/api/v1/offices/ofc_main/members")
      .set("Authorization", `Bearer ${analystToken}`);
    expect(deniedMembersResponse.status).toBe(403);
    expect(deniedMembersResponse.body.error.code).toBe("auth.office_admin_required");

    const updateResponse = await request(app)
      .patch("/api/v1/offices/ofc_main")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Orion Advisory Group" });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.name).toBe("Orion Advisory Group");
  });
});
