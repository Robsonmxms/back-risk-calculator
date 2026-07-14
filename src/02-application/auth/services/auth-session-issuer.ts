import { randomUUID } from "crypto";
import { AuthSession } from "../../../01-domain/auth/actor";
import { ApplicationError } from "../../errors/application-error";
import { RefreshTokenRepository, UserRepository } from "../../ports/repositories";
import {
  AccessTokenService,
  RefreshTokenGenerator
} from "../../ports/security";
import { GetActorForUserIdUseCase } from "../../users/use-cases/get-actor-for-user-id-use-case";
import { AuthUseCaseConfig } from "../auth-use-case-config";

export class AuthSessionIssuer {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokenGenerator: RefreshTokenGenerator,
    private readonly getActorForUserIdUseCase: GetActorForUserIdUseCase,
    private readonly config: AuthUseCaseConfig
  ) {}

  async issue(userId: string): Promise<AuthSession> {
    const user = await this.users.findById(userId);
    if (!user || user.status !== "active") {
      throw new ApplicationError(
        "unauthorized",
        "auth.actor_not_found",
        "Authenticated actor was not found"
      );
    }

    const refreshToken = this.refreshTokenGenerator.generate();
    await this.refreshTokens.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash: refreshToken.tokenHash,
      familyId: randomUUID(),
      expiresAt: this.refreshExpiresAt(),
      createdAt: new Date()
    });

    return {
      accessToken: this.accessTokens.sign({
        sub: user.id,
        role: user.role,
        email: user.email
      }),
      refreshToken: refreshToken.token,
      actor: await this.getActorForUserIdUseCase.execute(user.id)
    };
  }

  refreshExpiresAt(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  }
}
