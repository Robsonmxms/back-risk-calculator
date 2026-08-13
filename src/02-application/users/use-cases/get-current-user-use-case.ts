import { Actor, CurrentUserResponse } from "../../../01-domain/auth/actor";
import { ApplicationError } from "../../errors/application-error";
import { toSafeUser } from "../../../01-domain/users/user";
import { UserRepository } from "../../ports/repositories";

export class GetCurrentUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(actor: Actor): Promise<CurrentUserResponse> {
    const user = await this.users.findById(actor.id);
    if (!user) {
      throw new ApplicationError(
        "unauthorized",
        "auth.actor_not_found",
        "Authenticated actor was not found"
      );
    }

    return {
      actor,
      user: toSafeUser(user)
    };
  }
}
