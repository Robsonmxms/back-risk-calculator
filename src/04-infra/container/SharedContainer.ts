import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { AuthSessionIssuer } from "../../02-application/auth/services/auth-session-issuer";
import { GetActorForUserIdUseCase } from "../../02-application/users/use-cases/get-actor-for-user-id-use-case";
import { Logger } from "../../03-adapters/observability/Logger";
import { Metrics } from "../../03-adapters/observability/Metrics";
import { HmacJwtAccessTokenService } from "../../03-adapters/security/HmacJwtAccessTokenService";
import { ScryptPasswordHasher } from "../../03-adapters/security/ScryptPasswordHasher";
import { Sha256RefreshTokenGenerator } from "../../03-adapters/security/Sha256RefreshTokenGenerator";
import { AppConfig } from "../config/env";
import { InMemoryIdentityStore } from "../repositories/InMemoryIdentityStore";

export interface SharedContainerDependencies {
  identityStore?: InMemoryIdentityStore;
}

export interface SharedContainer {
  config: AppConfig;
  identityStore: InMemoryIdentityStore;
  logger: Logger;
  metrics: Metrics;
  passwordHasher: ScryptPasswordHasher;
  accessTokenService: HmacJwtAccessTokenService;
  refreshTokenGenerator: Sha256RefreshTokenGenerator;
  getActorForUserIdUseCase: GetActorForUserIdUseCase;
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase;
  sessionIssuer: AuthSessionIssuer;
}

export async function buildSharedContainer(
  config: AppConfig,
  dependencies: SharedContainerDependencies = {}
): Promise<SharedContainer> {
  const passwordHasher = new ScryptPasswordHasher();
  const identityStore = dependencies.identityStore ?? new InMemoryIdentityStore();
  const logger = new Logger();
  const metrics = new Metrics();
  const accessTokenService = new HmacJwtAccessTokenService(
    config.accessTokenSecret,
    config.accessTokenTtlSeconds
  );
  const refreshTokenGenerator = new Sha256RefreshTokenGenerator();
  const getActorForUserIdUseCase = new GetActorForUserIdUseCase(
    identityStore,
    identityStore,
    identityStore
  );
  const authenticateAccessTokenUseCase = new AuthenticateAccessTokenUseCase(
    accessTokenService,
    getActorForUserIdUseCase
  );
  const sessionIssuer = new AuthSessionIssuer(
    identityStore,
    identityStore,
    accessTokenService,
    refreshTokenGenerator,
    getActorForUserIdUseCase,
    config
  );

  return {
    config,
    identityStore,
    logger,
    metrics,
    passwordHasher,
    accessTokenService,
    refreshTokenGenerator,
    getActorForUserIdUseCase,
    authenticateAccessTokenUseCase,
    sessionIssuer
  };
}
