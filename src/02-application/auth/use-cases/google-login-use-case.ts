import { randomUUID } from "crypto";
import { AuthSession } from "../../../01-domain/auth/actor";
import { ApplicationError } from "../../errors/application-error";
import { LoggerPort, MetricsPort } from "../../ports/observability";
import { UserRepository } from "../../ports/repositories";
import { GoogleOAuthInput, GoogleOAuthVerifier } from "../../ports/security";
import { AuthSessionIssuer } from "../services/auth-session-issuer";

export class GoogleLoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly googleOAuthVerifier: GoogleOAuthVerifier,
    private readonly sessionIssuer: AuthSessionIssuer,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort
  ) {}

  async execute(input: GoogleOAuthInput): Promise<AuthSession> {
    const identity = await this.googleOAuthVerifier.verify(input);
    let user =
      (await this.users.findByGoogleSubject(identity.subject)) ??
      (await this.users.findByEmail(identity.email));

    if (!user) {
      user = await this.users.create({
        id: randomUUID(),
        email: identity.email,
        name: identity.name,
        role: "user",
        status: "active",
        googleSubject: identity.subject,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    } else if (!user.googleSubject) {
      user = await this.users.linkGoogleSubject(user.id, identity.subject);
    }

    if (!user || user.status !== "active") {
      this.metrics.increment("auth.login_failed");
      this.logger.warn("auth.oauth_failed", { provider: "google" });
      throw new ApplicationError("unauthorized", "auth.google_invalid", "Invalid Google credential");
    }

    this.metrics.increment("auth.login_succeeded");
    this.logger.info("auth.oauth_succeeded", { provider: "google", userId: user.id });
    return this.sessionIssuer.issue(user.id);
  }
}
