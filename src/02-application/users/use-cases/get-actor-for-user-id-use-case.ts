import { Actor } from "../../../01-domain/auth/actor";
import { ApplicationError } from "../../errors/application-error";
import { AccountRepository, UserRepository } from "../../ports/repositories";

export class GetActorForUserIdUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly accounts: AccountRepository
  ) {}

  async execute(userId: string): Promise<Actor> {
    const user = await this.users.findById(userId);
    if (!user || user.status !== "active") {
      throw new ApplicationError(
        "unauthorized",
        "auth.actor_not_found",
        "Authenticated actor was not found"
      );
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      accountMemberships: await this.accounts.listMembershipsForUser(user.id)
    };
  }
}
