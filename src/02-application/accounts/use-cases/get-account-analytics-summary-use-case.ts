import { Actor } from "../../../01-domain/auth/actor";
import { AccountRepository } from "../../ports/repositories";
import { assertCanReadAccountAnalytics } from "../../auth/policies";

export interface AccountAnalyticsSummary {
  accountId: string;
  exposureStatus: "available";
  riskScore: number;
  notes: string[];
}

export class GetAccountAnalyticsSummaryUseCase {
  constructor(private readonly accounts: AccountRepository) {}

  async execute(actor: Actor, accountId: string): Promise<AccountAnalyticsSummary> {
    const account = await this.accounts.findAccountById(accountId);
    const membership = await this.accounts.findMembership(accountId, actor.id);
    assertCanReadAccountAnalytics(actor, account, membership);

    return {
      accountId,
      exposureStatus: "available",
      riskScore: 42,
      notes: ["Analytics access authorized for this account."]
    };
  }
}
