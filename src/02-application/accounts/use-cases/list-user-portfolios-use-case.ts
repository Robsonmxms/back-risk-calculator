import { PortfolioAccountSnapshot } from "../../../01-domain/accounts/account";
import { Actor } from "../../../01-domain/auth/actor";
import { AccountRepository } from "../../ports/repositories";

export interface PortfolioListItem {
  accountId: string;
  accountName: string;
  membershipRole: PortfolioAccountSnapshot["membershipRole"];
  currency: string;
  marketValue: number;
  unrealizedPnl: number;
  dayChangePercent: number;
  holdingsCount: number;
  openAlerts: number;
  reportStatus: PortfolioAccountSnapshot["reportStatus"];
  riskScore: number;
  freshness: PortfolioAccountSnapshot["meta"]["freshness"];
  status: PortfolioAccountSnapshot["meta"]["status"];
}

export class ListUserPortfoliosUseCase {
  constructor(private readonly accounts: AccountRepository) {}

  async execute(actor: Actor): Promise<PortfolioListItem[]> {
    const snapshots = await this.accounts.listPortfolioSnapshotsForUser(actor.id);

    return snapshots.map((snapshot) => ({
      accountId: snapshot.accountId,
      accountName: snapshot.accountName,
      membershipRole: snapshot.membershipRole,
      currency: snapshot.currency,
      marketValue: snapshot.marketValue,
      unrealizedPnl: snapshot.unrealizedPnl,
      dayChangePercent: snapshot.dayChangePercent,
      holdingsCount: snapshot.holdingsCount,
      openAlerts: snapshot.openAlerts,
      reportStatus: snapshot.reportStatus,
      riskScore: snapshot.analytics.riskScore,
      freshness: snapshot.meta.freshness,
      status: snapshot.meta.status
    }));
  }
}
