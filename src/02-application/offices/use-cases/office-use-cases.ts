import { Actor } from "../../../01-domain/auth/actor";
import { Office, OfficeMembership } from "../../../01-domain/offices/office";
import { ApplicationError } from "../../errors/application-error";
import { OfficeRepository } from "../../ports/repositories";

export class ListOfficesUseCase {
  constructor(private readonly offices: OfficeRepository) {}

  async execute(actor: Actor) {
    return this.offices.listOfficesForUser(actor.id, actor.role === "admin");
  }
}

export class GetOfficeUseCase {
  constructor(private readonly offices: OfficeRepository) {}

  async execute(actor: Actor, officeId: string): Promise<Office> {
    await assertOfficeAccess(actor, officeId, this.offices);
    const office = await this.offices.findOfficeById(officeId);
    if (!office) {
      throw new ApplicationError("not_found", "office.not_found", "Office not found");
    }
    return office;
  }
}

export class ListOfficeMembersUseCase {
  constructor(private readonly offices: OfficeRepository) {}

  async execute(
    actor: Actor,
    officeId: string
  ): Promise<
    Array<
      OfficeMembership & {
        userName: string;
        userEmail: string;
      }
    >
  > {
    await assertOfficeAdmin(actor, officeId, this.offices);
    return this.offices.listOfficeMembers(officeId);
  }
}

export class UpdateOfficeUseCase {
  constructor(
    private readonly offices: OfficeRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    input: Partial<Pick<Office, "name" | "status">>
  ): Promise<Office> {
    await assertOfficeAdmin(actor, officeId, this.offices);
    const office = await this.offices.updateOffice(officeId, {
      name: input.name?.trim(),
      status: input.status,
      updatedAt: this.now()
    });
    if (!office) {
      throw new ApplicationError("not_found", "office.not_found", "Office not found");
    }
    return office;
  }
}

async function assertOfficeAccess(
  actor: Actor,
  officeId: string,
  offices: OfficeRepository
): Promise<void> {
  const office = await offices.findOfficeById(officeId);
  if (!office) {
    throw new ApplicationError("not_found", "office.not_found", "Office not found");
  }

  if (actor.role === "admin") {
    return;
  }

  const membership = await offices.findOfficeMembership(officeId, actor.id);
  if (membership) {
    return;
  }

  throw new ApplicationError("forbidden", "auth.office_access_denied", "Office access denied");
}

async function assertOfficeAdmin(
  actor: Actor,
  officeId: string,
  offices: OfficeRepository
): Promise<void> {
  await assertOfficeAccess(actor, officeId, offices);
  if (actor.role === "admin") {
    return;
  }

  const membership = await offices.findOfficeMembership(officeId, actor.id);
  if (membership?.role === "office_admin") {
    return;
  }

  throw new ApplicationError(
    "forbidden",
    "auth.office_admin_required",
    "Office admin permission required"
  );
}
