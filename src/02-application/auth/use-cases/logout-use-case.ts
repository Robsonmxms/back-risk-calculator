import { LoggerPort, MetricsPort } from "../../ports/observability";
import { RefreshTokenRepository } from "../../ports/repositories";
import { RefreshTokenGenerator } from "../../ports/security";

export class LogoutUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly refreshTokenGenerator: RefreshTokenGenerator,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort
  ) {}

  async execute(refreshToken: string, actorId: string): Promise<void> {
    const record = await this.refreshTokens.findByHash(
      this.refreshTokenGenerator.hash(refreshToken)
    );
    if (record && record.userId === actorId && !record.revokedAt) {
      await this.refreshTokens.revoke(record.id, new Date(), "logout");
    }

    this.metrics.increment("auth.logout");
    this.logger.info("auth.logout", { userId: actorId });
  }
}
