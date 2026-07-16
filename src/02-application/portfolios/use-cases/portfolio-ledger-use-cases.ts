import { randomUUID } from "crypto";
import { Account, AccountMember } from "../../../01-domain/accounts/account";
import { Actor } from "../../../01-domain/auth/actor";
import {
  PortfolioDetail,
  PortfolioPosition,
  PortfolioSnapshot,
  PortfolioSummary,
  PortfolioTransaction
} from "../../../01-domain/portfolios/portfolio";
import { assertCanManageAccountLedger, assertCanReadAccountLedger } from "../../auth/policies";
import { ApplicationError } from "../../errors/application-error";
import {
  AccountRepository,
  PortfolioRepository,
  UpdatePortfolioInput
} from "../../ports/repositories";

interface PortfolioAccess {
  account: Account;
  membership?: AccountMember;
}

async function getPortfolioAccess(
  actor: Actor,
  accountId: string,
  accounts: AccountRepository,
  mode: "read" | "manage"
): Promise<PortfolioAccess> {
  const account = await accounts.findAccountById(accountId);
  if (!account) {
    throw new ApplicationError("not_found", "account.not_found", "Account not found");
  }

  const membership = await accounts.findMembership(accountId, actor.id);
  if (mode === "read") {
    assertCanReadAccountLedger(actor, account, membership);
  } else {
    assertCanManageAccountLedger(actor, account, membership);
  }

  return { account, membership };
}

export class ListVisiblePortfoliosUseCase {
  constructor(private readonly portfolios: PortfolioRepository) {}

  async execute(actor: Actor): Promise<PortfolioSummary[]> {
    return this.portfolios.listVisiblePortfolios(actor.id, actor.role === "admin");
  }
}

export class CreatePortfolioUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository
  ) {}

  async execute(
    actor: Actor,
    input: { accountId: string; name: string; description?: string; baseCurrency: string }
  ) {
    await getPortfolioAccess(actor, input.accountId, this.accounts, "manage");

    const created = await this.portfolios.createPortfolio({
      id: randomUUID(),
      accountId: input.accountId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      baseCurrency: input.baseCurrency.trim().toUpperCase(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const detail = await this.portfolios.findVisiblePortfolioDetail(
      created.id,
      actor.id,
      actor.role === "admin"
    );
    if (!detail) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    return detail;
  }
}

export class GetPortfolioDetailUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository
  ) {}

  async execute(actor: Actor, portfolioId: string): Promise<PortfolioDetail> {
    const portfolio = await this.portfolios.findPortfolioById(portfolioId);
    if (!portfolio) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    await getPortfolioAccess(actor, portfolio.accountId, this.accounts, "read");
    const detail = await this.portfolios.findVisiblePortfolioDetail(
      portfolioId,
      actor.id,
      actor.role === "admin"
    );

    if (!detail) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    return detail;
  }
}

export class UpdatePortfolioUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository
  ) {}

  async execute(
    actor: Actor,
    portfolioId: string,
    input: Pick<UpdatePortfolioInput, "name" | "description">
  ) {
    const portfolio = await this.portfolios.findPortfolioById(portfolioId);
    if (!portfolio) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    await getPortfolioAccess(actor, portfolio.accountId, this.accounts, "manage");
    await this.portfolios.updatePortfolio(portfolioId, {
      name: input.name?.trim(),
      description: input.description?.trim() || undefined,
      updatedAt: new Date()
    });
    const detail = await this.portfolios.findVisiblePortfolioDetail(
      portfolioId,
      actor.id,
      actor.role === "admin"
    );
    if (!detail) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }
    return detail;
  }
}

export class ListPortfolioTransactionsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository
  ) {}

  async execute(actor: Actor, portfolioId: string): Promise<PortfolioTransaction[]> {
    const portfolio = await this.portfolios.findPortfolioById(portfolioId);
    if (!portfolio) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    await getPortfolioAccess(actor, portfolio.accountId, this.accounts, "read");
    return this.portfolios.listPortfolioTransactions(portfolioId);
  }
}

export class RecordPortfolioTransactionUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository
  ) {}

  async execute(
    actor: Actor,
    portfolioId: string,
    input: {
      assetSymbol: string;
      assetName: string;
      tradeDate: string;
      type: PortfolioTransaction["type"];
      quantity: number;
      unitPrice: number;
      currency: string;
      notes?: string;
      idempotencyKey?: string;
    }
  ) {
    const portfolio = await this.portfolios.findPortfolioById(portfolioId);
    if (!portfolio) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    await getPortfolioAccess(actor, portfolio.accountId, this.accounts, "manage");
    const idempotencyFingerprint = createTransactionIdempotencyFingerprint(input);

    if (input.idempotencyKey) {
      const existing = await this.portfolios.findTransactionIdempotencyRecord(
        portfolioId,
        input.idempotencyKey
      );
      if (existing) {
        if (existing.requestFingerprint !== idempotencyFingerprint) {
          throw new ApplicationError(
            "conflict",
            "portfolio.idempotency_key_payload_mismatch",
            "Idempotency key was already used with a different transaction payload"
          );
        }

        return existing.transaction;
      }
    }

    return this.portfolios.createPortfolioTransaction({
      id: randomUUID(),
      portfolioId,
      assetSymbol: input.assetSymbol.trim().toUpperCase(),
      assetName: input.assetName.trim(),
      tradeDate: input.tradeDate,
      type: input.type,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      totalAmount: Number((input.quantity * input.unitPrice).toFixed(2)),
      currency: input.currency.trim().toUpperCase(),
      notes: input.notes?.trim() || undefined,
      idempotencyKey: input.idempotencyKey,
      idempotencyFingerprint,
      createdAt: new Date()
    });
  }
}

function createTransactionIdempotencyFingerprint(input: {
  assetSymbol: string;
  assetName: string;
  tradeDate: string;
  type: PortfolioTransaction["type"];
  quantity: number;
  unitPrice: number;
  currency: string;
  notes?: string;
}): string {
  return JSON.stringify({
    assetSymbol: input.assetSymbol.trim().toUpperCase(),
    assetName: input.assetName.trim(),
    tradeDate: input.tradeDate,
    type: input.type,
    quantity: Number(input.quantity),
    unitPrice: Number(input.unitPrice),
    currency: input.currency.trim().toUpperCase(),
    notes: input.notes?.trim() || null
  });
}

export class ListPortfolioPositionsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository
  ) {}

  async execute(
    actor: Actor,
    portfolioId: string,
    asOfDate?: string
  ): Promise<PortfolioPosition[]> {
    const portfolio = await this.portfolios.findPortfolioById(portfolioId);
    if (!portfolio) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    await getPortfolioAccess(actor, portfolio.accountId, this.accounts, "read");
    return this.portfolios.listPortfolioPositions(portfolioId, asOfDate);
  }
}

export class ListPortfolioSnapshotsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository
  ) {}

  async execute(actor: Actor, portfolioId: string): Promise<PortfolioSnapshot[]> {
    const portfolio = await this.portfolios.findPortfolioById(portfolioId);
    if (!portfolio) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    await getPortfolioAccess(actor, portfolio.accountId, this.accounts, "read");
    return this.portfolios.listPortfolioSnapshots(portfolioId);
  }
}
