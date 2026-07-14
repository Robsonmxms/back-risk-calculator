import { Actor } from "../../../01-domain/auth/actor";
import { AccessTokenService } from "../../ports/security";
import { GetActorForUserIdUseCase } from "../../users/use-cases/get-actor-for-user-id-use-case";

export class AuthenticateAccessTokenUseCase {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly getActorForUserIdUseCase: GetActorForUserIdUseCase
  ) {}

  async execute(accessToken: string): Promise<Actor> {
    const claims = this.accessTokens.verify(accessToken);
    return this.getActorForUserIdUseCase.execute(claims.sub);
  }
}
