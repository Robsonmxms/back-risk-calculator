import { LoginUseCase } from "../../02-application/auth/use-cases/login-use-case";
import { LogoutUseCase } from "../../02-application/auth/use-cases/logout-use-case";
import { RefreshSessionUseCase } from "../../02-application/auth/use-cases/refresh-session-use-case";
import { AuthController } from "../../03-adapters/controllers/AuthController";
import { SharedContainer } from "./SharedContainer";

export interface AuthContainer {
  controller: AuthController;
  useCases: {
    loginUseCase: LoginUseCase;
    logoutUseCase: LogoutUseCase;
    refreshSessionUseCase: RefreshSessionUseCase;
  };
}

export function buildAuthContainer(shared: SharedContainer): AuthContainer {
  const loginUseCase = new LoginUseCase(
    shared.identityStore,
    shared.passwordHasher,
    shared.sessionIssuer,
    shared.logger,
    shared.metrics
  );
  const logoutUseCase = new LogoutUseCase(
    shared.identityStore,
    shared.refreshTokenGenerator,
    shared.logger,
    shared.metrics
  );
  const refreshSessionUseCase = new RefreshSessionUseCase(
    shared.identityStore,
    shared.identityStore,
    shared.accessTokenService,
    shared.refreshTokenGenerator,
    shared.getActorForUserIdUseCase,
    shared.sessionIssuer,
    shared.logger,
    shared.metrics
  );
  const controller = new AuthController(loginUseCase, refreshSessionUseCase, logoutUseCase);

  return {
    controller,
    useCases: {
      loginUseCase,
      logoutUseCase,
      refreshSessionUseCase
    }
  };
}
