import express from "express";
import { errorHandler } from "../03-adapters/http";
import { AccountController } from "../03-adapters/controllers/AccountController";
import { AdminController } from "../03-adapters/controllers/AdminController";
import { AuthController } from "../03-adapters/controllers/AuthController";
import { UserController } from "../03-adapters/controllers/UserController";
import { PortfolioController } from "../03-adapters/controllers/PortfolioController";
import { AuthenticateAccessTokenUseCase } from "../02-application/auth/use-cases/authenticate-access-token-use-case";
import { registerAccountRoutes } from "./routes/accountRoutes";
import { registerAdminRoutes } from "./routes/adminRoutes";
import { registerAuthRoutes } from "./routes/authRoutes";
import { registerPortfolioRoutes } from "./routes/portfolioRoutes";
import { registerUserRoutes } from "./routes/userRoutes";

export interface ServerDependencies {
  authController: AuthController;
  userController: UserController;
  adminController: AdminController;
  accountController: AccountController;
  portfolioController: PortfolioController;
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase;
}

export function createServer(dependencies: ServerDependencies) {
  const app = express();
  const apiRouter = express.Router();

  app.use(express.json());
  app.get("/health", (_request, response) => response.json({ status: "ok" }));

  registerAuthRoutes(
    apiRouter,
    dependencies.authController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerUserRoutes(
    apiRouter,
    dependencies.userController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerAdminRoutes(
    apiRouter,
    dependencies.adminController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerAccountRoutes(
    apiRouter,
    dependencies.accountController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerPortfolioRoutes(
    apiRouter,
    dependencies.portfolioController,
    dependencies.authenticateAccessTokenUseCase
  );

  app.use("/api/v1", apiRouter);
  app.use(errorHandler);

  return app;
}
