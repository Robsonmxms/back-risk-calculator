import { Request, Response } from "express";
import {
  CreatePortfolioUseCase,
  GetPortfolioDetailUseCase,
  ListPortfolioPositionsUseCase,
  ListPortfolioSnapshotsUseCase,
  ListPortfolioTransactionsUseCase,
  ListVisiblePortfoliosUseCase,
  RecordPortfolioTransactionUseCase,
  UpdatePortfolioUseCase
} from "../../02-application/portfolios/use-cases/portfolio-ledger-use-cases";
import { AuthenticatedRequest } from "../request";
import { ApiError, ok } from "../http";

export class PortfolioController {
  constructor(
    private readonly listVisiblePortfoliosUseCase: ListVisiblePortfoliosUseCase,
    private readonly createPortfolioUseCase: CreatePortfolioUseCase,
    private readonly getPortfolioDetailUseCase: GetPortfolioDetailUseCase,
    private readonly updatePortfolioUseCase: UpdatePortfolioUseCase,
    private readonly listPortfolioTransactionsUseCase: ListPortfolioTransactionsUseCase,
    private readonly recordPortfolioTransactionUseCase: RecordPortfolioTransactionUseCase,
    private readonly listPortfolioPositionsUseCase: ListPortfolioPositionsUseCase,
    private readonly listPortfolioSnapshotsUseCase: ListPortfolioSnapshotsUseCase
  ) {}

  listPortfolios = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolios = await this.listVisiblePortfoliosUseCase.execute(actor);
    return ok(response, { portfolios }, { count: portfolios.length });
  };

  createPortfolio = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolio = await this.createPortfolioUseCase.execute(actor, request.body);

    return response.status(201).json({ data: portfolio });
  };

  getPortfolio = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const portfolio = await this.getPortfolioDetailUseCase.execute(actor, portfolioId);

    return ok(response, portfolio, {
      freshness: portfolio.freshness,
      status: portfolio.status
    });
  };

  updatePortfolio = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const portfolio = await this.updatePortfolioUseCase.execute(actor, portfolioId, request.body);

    return ok(response, portfolio);
  };

  listTransactions = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const transactions = await this.listPortfolioTransactionsUseCase.execute(actor, portfolioId);

    return ok(response, { transactions }, { count: transactions.length });
  };

  recordTransaction = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const idempotencyKey = request.header("Idempotency-Key") ?? undefined;
    const transaction = await this.recordPortfolioTransactionUseCase.execute(actor, portfolioId, {
      ...request.body,
      idempotencyKey
    });

    return response.status(201).json({ data: transaction });
  };

  listPositions = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const asOfDate = typeof request.query.asOf === "string" ? request.query.asOf : undefined;
    const positions = await this.listPortfolioPositionsUseCase.execute(actor, portfolioId, asOfDate);

    return ok(
      response,
      { positions },
      {
        count: positions.length,
        ...(asOfDate ? { asOf: asOfDate } : {})
      }
    );
  };

  listSnapshots = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const snapshots = await this.listPortfolioSnapshotsUseCase.execute(actor, portfolioId);

    return ok(response, { snapshots }, { count: snapshots.length });
  };
}

function requirePortfolioId(request: Request): string {
  const { portfolioId } = request.params;

  if (typeof portfolioId !== "string") {
    throw new ApiError(400, "request.invalid_portfolio_id", "Invalid portfolio id");
  }

  return portfolioId;
}
