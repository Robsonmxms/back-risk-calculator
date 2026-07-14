import { PortfolioAccountSnapshot } from "../../../01-domain/accounts/account";
import { Actor } from "../../../01-domain/auth/actor";
import { assertCanReadAccountAnalytics } from "../../auth/policies";
import { ApplicationError } from "../../errors/application-error";
import { AccountRepository } from "../../ports/repositories";

export class GetAccountDashboardUseCase {
  constructor(private readonly accounts: AccountRepository) {}

  async execute(actor: Actor, accountId: string): Promise<PortfolioAccountSnapshot> {
    const account = await this.accounts.findAccountById(accountId);
    const membership = await this.accounts.findMembership(accountId, actor.id);
    assertCanReadAccountAnalytics(actor, account, membership);

    const snapshot = await this.accounts.findPortfolioSnapshotByAccountId(accountId);
    if (!snapshot) {
      throw new ApplicationError(
        "not_found",
        "account.dashboard_not_found",
        "Account dashboard data not found"
      );
    }

    return {
      ...snapshot,
      membershipRole:
        membership?.role ?? (account?.ownerUserId === actor.id ? "owner" : snapshot.membershipRole),
      accountName: account?.name ?? snapshot.accountName
    };
  }
}
