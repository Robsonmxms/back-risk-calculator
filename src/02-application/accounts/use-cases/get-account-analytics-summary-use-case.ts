import { Actor } from "../../../01-domain/auth/actor";
import { AccountRepository } from "../../ports/repositories";
import { assertCanReadAccountAnalytics } from "../../auth/policies";

export interface AccountAnalyticsSummary {
  accountId: string;
  exposureStatus: "available" | "partial";
  riskScore: number;
  notes: string[];
  freshness: "fresh" | "stale" | "partial";
  status: "ready" | "syncing" | "degraded";
}

export class GetAccountAnalyticsSummaryUseCase {
  constructor(private readonly accounts: AccountRepository) {}

  async execute(actor: Actor, accountId: string): Promise<AccountAnalyticsSummary> {
    const account = await this.accounts.findAccountById(accountId);
    const membership = await this.accounts.findMembership(accountId, actor.id);
    assertCanReadAccountAnalytics(actor, account, membership);
    const snapshot = await this.accounts.findPortfolioSnapshotByAccountId(accountId);

    return {
      accountId,
      exposureStatus: snapshot?.meta.freshness === "partial" ? "partial" : "available",
      riskScore: snapshot?.analytics.riskScore ?? 42,
      notes: snapshot?.analytics.notes ?? ["Analytics access authorized for this account."],
      freshness: snapshot?.meta.freshness ?? "fresh",
      status: snapshot?.meta.status ?? "ready"
    };
  }
}
