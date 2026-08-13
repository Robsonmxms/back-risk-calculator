import { AuthSession } from "../../../01-domain/auth/actor";
import { ApplicationError } from "../../errors/application-error";
import { LoggerPort, MetricsPort } from "../../ports/observability";
import { UserRepository } from "../../ports/repositories";
import { PasswordHasher } from "../../ports/security";
import { AuthSessionIssuer } from "../services/auth-session-issuer";

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessionIssuer: AuthSessionIssuer,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort
  ) {}

  async execute(email: string, password: string): Promise<AuthSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users.findByEmail(normalizedEmail);
    const passwordMatches = await this.passwordHasher.verify(password, user?.passwordHash);

    if (!user || user.status !== "active" || !passwordMatches) {
      this.metrics.increment("auth.login_failed");
      this.logger.warn("auth.login_failed", { email: normalizedEmail });
      throw new ApplicationError("unauthorized", "auth.invalid_credentials", "Invalid credentials");
    }

    this.metrics.increment("auth.login_succeeded");
    this.logger.info("auth.login_succeeded", { userId: user.id });
    return this.sessionIssuer.issue(user.id);
  }
}
