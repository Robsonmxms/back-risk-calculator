import { randomUUID } from "crypto";
import { Account, AccountMember } from "../../01-domain/accounts/account";
import { Actor } from "../../01-domain/auth/actor";
import { assertCanReadAccountLedger } from "../../02-application/auth/policies";
import { ApplicationError } from "../../02-application/errors/application-error";
import { AccountRepository, PortfolioRepository } from "../../02-application/ports/repositories";
import { AnalyticsEventPublisher, AnalyticsRepository } from "./ports";
import { AnalyticsJob, PortfolioAnalyticsReadModel } from "./types";

interface PortfolioAccess {
  account: Account;
  membership?: AccountMember;
}

async function assertPortfolioReadAccess(
  actor: Actor,
  portfolioId: string,
  accounts: AccountRepository,
  portfolios: PortfolioRepository
): Promise<PortfolioAccess> {
  const portfolio = await portfolios.findPortfolioById(portfolioId);
  if (!portfolio) {
    throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
  }

  const account = await accounts.findAccountById(portfolio.accountId);
  if (!account) {
    throw new ApplicationError("not_found", "account.not_found", "Account not found");
  }

  const membership = await accounts.findMembership(portfolio.accountId, actor.id);
  assertCanReadAccountLedger(actor, account, membership);
  return { account, membership };
}

export class GetPortfolioAnalyticsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly analytics: AnalyticsRepository
  ) {}

  async execute(actor: Actor, portfolioId: string): Promise<PortfolioAnalyticsReadModel> {
    await assertPortfolioReadAccess(actor, portfolioId, this.accounts, this.portfolios);
    const snapshot = await this.analytics.findLatestSnapshot(portfolioId);
    const latestJob = await this.analytics.findLatestJob(portfolioId);

    if (!snapshot) {
      return {
        portfolioId,
        status: latestJob?.status === "failed" ? "failed" : "pending",
        baseCurrency: "USD",
        snapshot: null,
        lastSuccessfulSnapshot: null,
        failedJob: latestJob?.status === "failed" ? latestJob : undefined
      };
    }

    return {
      portfolioId,
      status:
        latestJob?.status === "failed"
          ? "failed"
          : latestJob?.status === "queued" || latestJob?.status === "running"
            ? "pending"
            : snapshot.status,
      baseCurrency: "USD",
      snapshot,
      lastSuccessfulSnapshot: snapshot,
      failedJob: latestJob?.status === "failed" ? latestJob : undefined
    };
  }
}

export class ListPortfolioAnalyticsHistoryUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly analytics: AnalyticsRepository
  ) {}

  async execute(actor: Actor, portfolioId: string) {
    await assertPortfolioReadAccess(actor, portfolioId, this.accounts, this.portfolios);
    return this.analytics.listSnapshots(portfolioId);
  }
}

export class RequestPortfolioAnalyticsRecomputeUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly analytics: AnalyticsRepository,
    private readonly events: AnalyticsEventPublisher,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    portfolioId: string,
    correlationId: string = randomUUID()
  ): Promise<AnalyticsJob> {
    await assertPortfolioReadAccess(actor, portfolioId, this.accounts, this.portfolios);

    const createdAt = this.now();
    const job = await this.analytics.enqueue({
      id: randomUUID(),
      portfolioId,
      requestedBy: actor.id,
      correlationId,
      status: "queued",
      attempts: 0,
      createdAt,
      updatedAt: createdAt
    });

    await this.events.publish("AnalyticsRequested", portfolioId, {
      portfolioId,
      jobId: job.id,
      requestedBy: actor.id,
      correlationId
    });

    return job;
  }
}
