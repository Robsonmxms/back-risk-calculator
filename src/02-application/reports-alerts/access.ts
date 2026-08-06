import { Account, AccountMember } from "../../01-domain/accounts/account";
import { Actor } from "../../01-domain/auth/actor";
import { assertCanReadAccountLedger } from "../../02-application/auth/policies";
import { ApplicationError } from "../../02-application/errors/application-error";
import { AccountRepository, PortfolioRepository } from "../../02-application/ports/repositories";

export interface PortfolioAccess {
  account: Account;
  membership?: AccountMember;
}

export async function assertPortfolioReadAccess(
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

export async function listVisiblePortfolioIds(
  actor: Actor,
  portfolios: PortfolioRepository
): Promise<string[]> {
  const summaries = await portfolios.listVisiblePortfolios(actor.id, actor.role === "admin");
  return summaries.map((portfolio) => portfolio.id);
}
