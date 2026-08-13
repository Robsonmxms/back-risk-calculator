import { randomUUID } from "crypto";
import { Actor } from "../../../01-domain/auth/actor";
import {
  UserManagementAction,
  UserManagementOutcome
} from "../../../01-domain/users/user-management-audit";
import { SafeUser, toSafeUser, UserRole, UserStatus } from "../../../01-domain/users/user";
import { ApplicationError } from "../../errors/application-error";
import { LoggerPort, MetricsPort } from "../../ports/observability";
import { RefreshTokenRepository, UserRepository } from "../../ports/repositories";
import { PasswordHasher } from "../../ports/security";
import { UserManagementAuditPort, UserManagementEventPublisher } from "../ports";
import {
  assertNotSelfManagement,
  assertResultingRole,
  assertTargetRole,
  assertUserManager
} from "../user-management-policy";

export interface UserListInput {
  role: UserRole;
  search?: string;
  status?: UserStatus;
  page: number;
  perPage: number;
}

export interface UserPagination {
  page: number;
  per_page: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface UserListResult {
  users: SafeUser[];
  pagination: UserPagination;
}

export interface CreateManagedUserInput {
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  initialPassword: string;
}

export interface UpdateManagedUserInput {
  name?: string;
  email?: string;
  role?: UserRole;
  status?: UserStatus;
}

interface UserManagementUseCaseDependencies {
  users: UserRepository;
  audits: UserManagementAuditPort;
  events: UserManagementEventPublisher;
  logger: LoggerPort;
  metrics: MetricsPort;
  now?: () => Date;
}

export class ListManagedUsersUseCase {
  private readonly now: () => Date;

  constructor(private readonly dependencies: UserManagementUseCaseDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(
    actor: Actor,
    input: UserListInput,
    correlationId: string
  ): Promise<UserListResult> {
    try {
      assertTargetRole(actor, input.role);
      const page = await this.dependencies.users.listManagedUsers(input);
      const totalPages = page.totalItems === 0 ? 0 : Math.ceil(page.totalItems / page.perPage);
      await recordOutcome(this.dependencies, {
        actor,
        correlationId,
        action: "list",
        outcome: "success",
        reasonCode: "user.list_succeeded",
        targetRole: input.role,
        now: this.now
      });
      return {
        users: page.users.map(toSafeUser),
        pagination: {
          page: page.page,
          per_page: page.perPage,
          total_items: page.totalItems,
          total_pages: totalPages,
          has_next: page.page < totalPages,
          has_prev: page.page > 1 && totalPages > 0
        }
      };
    } catch (error) {
      await recordFailure(this.dependencies, actor, correlationId, "list", error, this.now, {
        targetRole: input.role
      });
      throw error;
    }
  }
}

export class CreateManagedUserUseCase {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: UserManagementUseCaseDependencies & {
      passwordHasher: PasswordHasher;
    }
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(
    actor: Actor,
    input: CreateManagedUserInput,
    correlationId: string
  ): Promise<SafeUser> {
    try {
      assertTargetRole(actor, input.role);
      assertInitialPassword(input.initialPassword);
      const now = this.now();
      const passwordHash = await this.dependencies.passwordHasher.hash(input.initialPassword);
      const user = await this.dependencies.users.createManagedUser({
        id: `usr_${randomUUID()}`,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        status: input.status,
        passwordHash,
        createdAt: now,
        updatedAt: now
      });
      if (!user) {
        throw new ApplicationError(
          "conflict",
          "user.email_conflict",
          "A user with this email already exists"
        );
      }

      await this.dependencies.events.publishUserManagementEvent("user.created", user.id, {
        version: 1,
        actorId: actor.id,
        role: user.role,
        status: user.status
      });
      await recordOutcome(this.dependencies, {
        actor,
        correlationId,
        action: "create",
        outcome: "success",
        reasonCode: "user.create_succeeded",
        targetId: user.id,
        targetRole: user.role,
        resultingRole: user.role,
        resultingStatus: user.status,
        changedFields: ["name", "email", "role", "status"],
        now: this.now
      });
      return toSafeUser(user);
    } catch (error) {
      await recordFailure(this.dependencies, actor, correlationId, "create", error, this.now, {
        targetRole: input.role,
        resultingRole: input.role
      });
      throw error;
    }
  }
}

export class UpdateManagedUserUseCase {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: UserManagementUseCaseDependencies & {
      refreshTokens: RefreshTokenRepository;
    }
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(
    actor: Actor,
    targetId: string,
    input: UpdateManagedUserInput,
    correlationId: string
  ): Promise<SafeUser> {
    let currentRole: UserRole | undefined;
    try {
      assertUserManager(actor);
      assertNotSelfManagement(actor, targetId);
      const current = await this.dependencies.users.findById(targetId);
      if (!current) {
        throw new ApplicationError("not_found", "user.not_found", "User not found");
      }
      currentRole = current.role;
      assertTargetRole(actor, current.role);
      assertResultingRole(actor, input.role ?? current.role);

      const now = this.now();
      const result = await this.dependencies.users.updateManagedUser(targetId, {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.email !== undefined ? { email: input.email.trim().toLowerCase() } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: now
      });
      if (result.outcome !== "updated") {
        throw updateFailure(result.outcome);
      }

      const changedFields = (Object.keys(input) as Array<keyof UpdateManagedUserInput>).filter(
        (field) => input[field] !== result.previous[field]
      );
      const roleChanged = result.previous.role !== result.user.role;
      const statusChanged = result.previous.status !== result.user.status;
      if (roleChanged || statusChanged) {
        await this.dependencies.refreshTokens.revokeAllForUser(
          result.user.id,
          now,
          statusChanged ? "status_changed" : "role_changed"
        );
      }

      await this.dependencies.events.publishUserManagementEvent("user.updated", result.user.id, {
        version: 1,
        actorId: actor.id,
        role: result.user.role,
        status: result.user.status
      });
      if (roleChanged) {
        await this.dependencies.events.publishUserManagementEvent(
          "user.role_changed",
          result.user.id,
          {
            version: 1,
            actorId: actor.id,
            previousRole: result.previous.role,
            role: result.user.role
          }
        );
      }
      if (statusChanged) {
        await this.dependencies.events.publishUserManagementEvent(
          "user.status_changed",
          result.user.id,
          {
            version: 1,
            actorId: actor.id,
            previousStatus: result.previous.status,
            status: result.user.status
          }
        );
      }
      await recordOutcome(this.dependencies, {
        actor,
        correlationId,
        action: "update",
        outcome: "success",
        reasonCode: "user.update_succeeded",
        targetId,
        targetRole: result.previous.role,
        resultingRole: result.user.role,
        previousStatus: result.previous.status,
        resultingStatus: result.user.status,
        changedFields,
        now: this.now
      });
      return toSafeUser(result.user);
    } catch (error) {
      await recordFailure(this.dependencies, actor, correlationId, "update", error, this.now, {
        targetId,
        targetRole: currentRole,
        resultingRole: input.role
      });
      throw error;
    }
  }
}

function assertInitialPassword(password: string): void {
  if (
    password.length < 12 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new ApplicationError(
      "invalid",
      "request.validation_failed",
      "Request validation failed",
      {
        fields: [
          {
            path: "initialPassword",
            message:
              "A senha inicial deve ter 12 caracteres, maiúscula, minúscula, número e símbolo."
          }
        ]
      }
    );
  }
}

function updateFailure(
  outcome: "not_found" | "email_conflict" | "last_active_admin_required"
): ApplicationError {
  if (outcome === "not_found") {
    return new ApplicationError("not_found", "user.not_found", "User not found");
  }
  if (outcome === "email_conflict") {
    return new ApplicationError(
      "conflict",
      "user.email_conflict",
      "A user with this email already exists"
    );
  }
  return new ApplicationError(
    "conflict",
    "user.last_active_admin_required",
    "At least one active administrator is required"
  );
}

interface OutcomeContext {
  actor: Actor;
  correlationId: string;
  action: UserManagementAction;
  outcome: UserManagementOutcome;
  reasonCode: string;
  targetId?: string;
  targetRole?: UserRole;
  resultingRole?: UserRole;
  previousStatus?: UserStatus;
  resultingStatus?: UserStatus;
  changedFields?: string[];
  now: () => Date;
}

async function recordOutcome(
  dependencies: Pick<UserManagementUseCaseDependencies, "audits" | "logger" | "metrics">,
  context: OutcomeContext
): Promise<void> {
  const metricPrefix = `user.management.${context.action}.${context.outcome}`;
  dependencies.metrics.increment(metricPrefix);
  dependencies.metrics.increment(`${metricPrefix}.actor_role.${context.actor.role}`);
  dependencies.metrics.increment(`${metricPrefix}.target_role.${context.targetRole ?? "unknown"}`);
  dependencies.metrics.increment(`${metricPrefix}.reason.${context.reasonCode}`);
  const log =
    context.outcome === "success"
      ? dependencies.logger.info.bind(dependencies.logger)
      : dependencies.logger.warn.bind(dependencies.logger);
  log(`user.management.${context.action}.${context.outcome}`, {
    correlationId: context.correlationId,
    actorId: context.actor.id,
    actorRole: context.actor.role,
    action: context.action,
    outcome: context.outcome,
    targetId: context.targetId,
    targetRole: context.targetRole,
    resultingRole: context.resultingRole,
    reasonCode: context.reasonCode
  });
  await dependencies.audits.recordUserManagementAudit({
    id: randomUUID(),
    correlationId: context.correlationId,
    actorId: context.actor.id,
    actorRole: context.actor.role,
    targetId: context.targetId,
    targetRole: context.targetRole,
    resultingRole: context.resultingRole,
    previousStatus: context.previousStatus,
    resultingStatus: context.resultingStatus,
    changedFields: context.changedFields ?? [],
    action: context.action,
    outcome: context.outcome,
    reasonCode: context.reasonCode,
    createdAt: context.now()
  });
}

async function recordFailure(
  dependencies: Pick<UserManagementUseCaseDependencies, "audits" | "logger" | "metrics">,
  actor: Actor,
  correlationId: string,
  action: UserManagementAction,
  error: unknown,
  now: () => Date,
  target: { targetId?: string; targetRole?: UserRole; resultingRole?: UserRole }
): Promise<void> {
  const reasonCode = error instanceof ApplicationError ? error.code : "internal.unexpected_error";
  const outcome: UserManagementOutcome =
    error instanceof ApplicationError && error.kind === "not_found"
      ? "not_found"
      : error instanceof ApplicationError && error.kind === "conflict"
        ? "conflict"
        : "denied";
  await recordOutcome(dependencies, {
    actor,
    correlationId,
    action,
    outcome,
    reasonCode,
    ...target,
    now
  });
}
