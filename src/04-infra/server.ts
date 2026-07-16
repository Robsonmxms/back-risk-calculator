import express, { NextFunction, Request, Response } from "express";
import { errorHandler } from "../03-adapters/http";
import { AccountController } from "../03-adapters/controllers/AccountController";
import { AdminController } from "../03-adapters/controllers/AdminController";
import { AuthController } from "../03-adapters/controllers/AuthController";
import { UserController } from "../03-adapters/controllers/UserController";
import { PortfolioController } from "../03-adapters/controllers/PortfolioController";
import { MarketDataController } from "../03-adapters/controllers/MarketDataController";
import { AnalyticsController } from "../03-adapters/controllers/AnalyticsController";
import { ReportsAlertsController } from "../03-adapters/controllers/ReportsAlertsController";
import { AuthenticateAccessTokenUseCase } from "../02-application/auth/use-cases/authenticate-access-token-use-case";
import { registerAccountRoutes } from "./routes/accountRoutes";
import { registerAdminRoutes } from "./routes/adminRoutes";
import { registerAnalyticsRoutes } from "./routes/analyticsRoutes";
import { registerAuthRoutes } from "./routes/authRoutes";
import { registerMarketDataRoutes } from "./routes/marketDataRoutes";
import { registerPortfolioRoutes } from "./routes/portfolioRoutes";
import { registerReportsAlertsRoutes } from "./routes/reportsAlertsRoutes";
import { registerUserRoutes } from "./routes/userRoutes";

export interface ServerDependencies {
  authController: AuthController;
  userController: UserController;
  adminController: AdminController;
  accountController: AccountController;
  portfolioController: PortfolioController;
  marketDataController: MarketDataController;
  analyticsController: AnalyticsController;
  reportsAlertsController: ReportsAlertsController;
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase;
}

export function createServer(dependencies: ServerDependencies) {
  const app = express();
  const apiRouter = express.Router();

  app.use(corsMiddleware);
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
  registerAnalyticsRoutes(
    apiRouter,
    dependencies.analyticsController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerMarketDataRoutes(
    apiRouter,
    dependencies.marketDataController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerReportsAlertsRoutes(
    apiRouter,
    dependencies.reportsAlertsController,
    dependencies.authenticateAccessTokenUseCase
  );

  app.use("/api/v1", apiRouter);
  app.use(errorHandler);

  return app;
}

function corsMiddleware(request: Request, response: Response, next: NextFunction) {
  const origin = request.headers.origin;

  if (origin && isAllowedCorsOrigin(origin)) {
    response.header("Access-Control-Allow-Origin", origin);
    response.header("Vary", "Origin");
    response.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    response.header("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key");
    response.header("Access-Control-Max-Age", "600");
  }

  if (request.method === "OPTIONS") {
    return response.sendStatus(204);
  }

  return next();
}

function isAllowedCorsOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}
