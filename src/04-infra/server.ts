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
import { OfficeController } from "../03-adapters/controllers/OfficeController";
import { ClientController } from "../03-adapters/controllers/ClientController";
import { WorkbenchController } from "../03-adapters/controllers/WorkbenchController";
import { ComplianceController } from "../03-adapters/controllers/ComplianceController";
import { ReportDeliveryController } from "../03-adapters/controllers/ReportDeliveryController";
import { OperationalChartsController } from "../03-adapters/controllers/OperationalChartsController";
import { AuthenticateAccessTokenUseCase } from "../02-application/auth/use-cases/authenticate-access-token-use-case";
import { registerAccountRoutes } from "./routes/accountRoutes";
import { registerAdminRoutes } from "./routes/adminRoutes";
import { registerAnalyticsRoutes } from "./routes/analyticsRoutes";
import { registerAuthRoutes } from "./routes/authRoutes";
import { registerMarketDataRoutes } from "./routes/marketDataRoutes";
import { registerOfficeRoutes } from "./routes/officeRoutes";
import { registerClientRoutes } from "./routes/clientRoutes";
import { registerOperationalChartRoutes } from "./routes/operationalChartRoutes";
import { registerWorkbenchRoutes } from "./routes/workbenchRoutes";
import { registerComplianceRoutes } from "./routes/complianceRoutes";
import { registerReportDeliveryRoutes } from "./routes/reportDeliveryRoutes";
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
  officeController: OfficeController;
  clientController: ClientController;
  operationalChartsController: OperationalChartsController;
  workbenchController: WorkbenchController;
  complianceController: ComplianceController;
  reportDeliveryController: ReportDeliveryController;
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase;
  corsAllowedOrigins?: string[];
}

export function createServer(dependencies: ServerDependencies) {
  const app = express();
  const apiRouter = express.Router();

  app.disable("etag");
  app.set("corsAllowedOrigins", dependencies.corsAllowedOrigins ?? []);
  app.use(corsMiddleware);
  app.use(express.json());
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  apiRouter.use(apiCachePolicyMiddleware);

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
  registerOfficeRoutes(
    apiRouter,
    dependencies.officeController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerClientRoutes(
    apiRouter,
    dependencies.clientController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerOperationalChartRoutes(
    apiRouter,
    dependencies.operationalChartsController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerWorkbenchRoutes(
    apiRouter,
    dependencies.workbenchController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerComplianceRoutes(
    apiRouter,
    dependencies.complianceController,
    dependencies.authenticateAccessTokenUseCase
  );
  registerReportDeliveryRoutes(
    apiRouter,
    dependencies.reportDeliveryController,
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
  app.use("/api/v1", (_request, response) =>
    response.status(404).json({
      error: {
        code: "request.route_not_found",
        message: "Route not found"
      }
    })
  );
  app.use(errorHandler);

  return app;
}

function corsMiddleware(request: Request, response: Response, next: NextFunction) {
  const origin = request.headers.origin;
  const allowedOrigins = request.app.get("corsAllowedOrigins") as string[] | undefined;

  if (origin && isAllowedCorsOrigin(origin, allowedOrigins ?? [])) {
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

function apiCachePolicyMiddleware(_request: Request, response: Response, next: NextFunction) {
  response.header("Cache-Control", "no-store");
  response.header("Pragma", "no-cache");
  response.header("Expires", "0");
  response.vary("Authorization");

  return next();
}

function isAllowedCorsOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}
