import { Actor } from "../../../01-domain/auth/actor";
import { SafeUser, toSafeUser } from "../../../01-domain/users/user";
import { assertAdmin } from "../../auth/policies";
import { UserRepository } from "../../ports/repositories";

export class ListUsersUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(actor: Actor): Promise<SafeUser[]> {
    assertAdmin(actor);
    return (await this.users.list()).map(toSafeUser);
  }
}
