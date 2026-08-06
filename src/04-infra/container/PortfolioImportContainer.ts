import { PermissionService } from "../../02-application/auth/permission-service";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
  CreatePortfolioImportUseCase,
  DownloadPortfolioImportErrorReportUseCase,
  DownloadPortfolioImportTemplateUseCase,
  GetPortfolioImportUseCase,
  ListPortfolioImportsUseCase
} from "../../02-application/portfolio-imports/use-cases";
import {
  PortfolioImportQueue,
  PortfolioImportRepository,
  PortfolioImportStorage,
  PortfolioImportWorkbookService
} from "../../02-application/portfolio-imports/ports";
import { PortfolioImportWorker } from "../../02-application/portfolio-imports/worker";
import { PortfolioImportController } from "../../03-adapters/controllers/PortfolioImportController";
import { ExcelJsPortfolioImportWorkbook } from "../portfolio-imports/ExcelJsPortfolioImportWorkbook";
import {
  InMemoryPortfolioImportQueue,
  InMemoryPortfolioImportRepository,
  InMemoryPortfolioImportStorage
} from "../portfolio-imports/InMemoryPortfolioImportInfrastructure";
import { SqsPortfolioImportQueue } from "../portfolio-imports/SqsPortfolioImportQueue";
import { SharedContainer } from "./SharedContainer";

export interface PortfolioImportContainerDependencies {
  repository?: PortfolioImportRepository;
  storage?: PortfolioImportStorage;
  queue?: PortfolioImportQueue;
  workbook?: PortfolioImportWorkbookService;
  now?: () => Date;
  autoProcess?: boolean;
}

export interface PortfolioImportContainer {
  controller: PortfolioImportController;
  repository: PortfolioImportRepository;
  storage: PortfolioImportStorage;
  queue: PortfolioImportQueue;
  workbook: PortfolioImportWorkbookService;
  worker: PortfolioImportWorker;
}

export function buildPortfolioImportContainer(
  shared: SharedContainer,
  dependencies: PortfolioImportContainerDependencies = {}
): PortfolioImportContainer {
  const repository = dependencies.repository ?? new InMemoryPortfolioImportRepository();
  const storage = dependencies.storage ?? new InMemoryPortfolioImportStorage();
  const queue = dependencies.queue ?? buildQueue(shared);
  const workbook = dependencies.workbook ?? new ExcelJsPortfolioImportWorkbook();
  const now = dependencies.now ?? (() => new Date());
  const permissions = new PermissionService(shared.identityStore, shared.identityStore);
  const worker = new PortfolioImportWorker(
    shared.identityStore,
    shared.identityStore,
    repository,
    storage,
    queue,
    workbook,
    shared.logger,
    shared.metrics,
    now
  );
  const controller = new PortfolioImportController(
    new DownloadPortfolioImportTemplateUseCase(workbook),
    new CreatePortfolioImportUseCase(
      shared.identityStore,
      permissions,
      repository,
      storage,
      queue,
      now
    ),
    new ListPortfolioImportsUseCase(shared.identityStore, repository),
    new GetPortfolioImportUseCase(shared.identityStore, repository),
    new DownloadPortfolioImportErrorReportUseCase(shared.identityStore, repository, storage),
    () => {
      if (dependencies.autoProcess === false) return;
      setImmediate(() => void worker.drain());
    }
  );

  return { controller, repository, storage, queue, workbook, worker };
}

function buildQueue(shared: SharedContainer): PortfolioImportQueue {
  if (shared.config.portfolioImportQueueProvider === "memory") {
    return new InMemoryPortfolioImportQueue();
  }
  return new SqsPortfolioImportQueue(
    new SQSClient({
      region: shared.config.awsRegion,
      endpoint: shared.config.awsEndpoint
    }),
    {
      queueUrl: shared.config.portfolioImportQueueUrl!,
      deadLetterQueueUrl: shared.config.portfolioImportDeadLetterQueueUrl!
    }
  );
}
