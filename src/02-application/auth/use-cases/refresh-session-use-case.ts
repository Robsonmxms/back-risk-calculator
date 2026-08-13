import { randomUUID } from "crypto";
import { AuthSession } from "../../../01-domain/auth/actor";
import { ApplicationError } from "../../errors/application-error";
import { LoggerPort, MetricsPort } from "../../ports/observability";
import { RefreshTokenRepository, UserRepository } from "../../ports/repositories";
import { AccessTokenService, RefreshTokenGenerator } from "../../ports/security";
import { GetActorForUserIdUseCase } from "../../users/use-cases/get-actor-for-user-id-use-case";
import { AuthSessionIssuer } from "../services/auth-session-issuer";

export class RefreshSessionUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokenGenerator: RefreshTokenGenerator,
    private readonly getActorForUserIdUseCase: GetActorForUserIdUseCase,
    private readonly sessionIssuer: AuthSessionIssuer,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort
  ) {}

  async execute(refreshToken: string): Promise<AuthSession> {
    const now = new Date();
    const tokenHash = this.refreshTokenGenerator.hash(refreshToken);
    const existing = await this.refreshTokens.findByHash(tokenHash);

    if (!existing) {
      this.metrics.increment("auth.refresh_failed");
      throw new ApplicationError("unauthorized", "auth.refresh_invalid", "Invalid refresh token");
    }

    if (existing.replacedByTokenId) {
      await this.refreshTokens.revokeFamily(existing.familyId, now, "reuse_detected");
      this.metrics.increment("auth.refresh_reuse_detected");
      this.logger.warn("auth.refresh_reuse_detected", {
        userId: existing.userId,
        familyId: existing.familyId
      });
      throw new ApplicationError(
        "unauthorized",
        "auth.refresh_reused",
        "Refresh token reuse detected"
      );
    }

    if (existing.revokedAt) {
      throw new ApplicationError("unauthorized", "auth.refresh_revoked", "Refresh token revoked");
    }

    if (existing.expiresAt <= now) {
      await this.refreshTokens.revoke(existing.id, now, "expired");
      throw new ApplicationError("unauthorized", "auth.refresh_expired", "Refresh token expired");
    }

    const user = await this.users.findById(existing.userId);
    if (!user || user.status !== "active") {
      throw new ApplicationError(
        "unauthorized",
        "auth.actor_not_found",
        "Authenticated actor was not found"
      );
    }

    const nextRefreshToken = this.refreshTokenGenerator.generate();
    const nextRecord = await this.refreshTokens.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash: nextRefreshToken.tokenHash,
      familyId: existing.familyId,
      expiresAt: this.sessionIssuer.refreshExpiresAt(),
      createdAt: now
    });
    await this.refreshTokens.markRotated(existing.id, nextRecord.id, now);

    this.metrics.increment("auth.refresh_rotated");
    this.logger.info("auth.refresh_rotated", { userId: user.id, familyId: existing.familyId });

    return {
      accessToken: this.accessTokens.sign({
        sub: user.id,
        role: user.role,
        email: user.email
      }),
      refreshToken: nextRefreshToken.token,
      actor: await this.getActorForUserIdUseCase.execute(user.id)
    };
  }
}
