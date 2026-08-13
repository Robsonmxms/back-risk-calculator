import {
  CreatePortfolioUseCase,
  GetPortfolioDetailUseCase,
  ListPortfolioPositionsUseCase,
  ListPortfolioSnapshotsUseCase,
  ListPortfolioTransactionsUseCase,
  ListVisiblePortfoliosUseCase,
  RecordPortfolioTransactionUseCase,
  UpdatePortfolioUseCase
} from "../../02-application/portfolios/use-cases/portfolio-ledger-use-cases";
import { PermissionService } from "../../02-application/auth/permission-service";
import { PortfolioController } from "../../03-adapters/controllers/PortfolioController";
import { SharedContainer } from "./SharedContainer";

export interface PortfolioContainer {
  controller: PortfolioController;
  useCases: {
    listVisiblePortfoliosUseCase: ListVisiblePortfoliosUseCase;
    createPortfolioUseCase: CreatePortfolioUseCase;
    getPortfolioDetailUseCase: GetPortfolioDetailUseCase;
    updatePortfolioUseCase: UpdatePortfolioUseCase;
    listPortfolioTransactionsUseCase: ListPortfolioTransactionsUseCase;
    recordPortfolioTransactionUseCase: RecordPortfolioTransactionUseCase;
    listPortfolioPositionsUseCase: ListPortfolioPositionsUseCase;
    listPortfolioSnapshotsUseCase: ListPortfolioSnapshotsUseCase;
  };
}

export function buildPortfolioContainer(shared: SharedContainer): PortfolioContainer {
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);
  const listVisiblePortfoliosUseCase = new ListVisiblePortfoliosUseCase(shared.identityStore);
  const createPortfolioUseCase = new CreatePortfolioUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService
  );
  const getPortfolioDetailUseCase = new GetPortfolioDetailUseCase(
    shared.identityStore,
    shared.identityStore
  );
  const updatePortfolioUseCase = new UpdatePortfolioUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService
  );
  const listPortfolioTransactionsUseCase = new ListPortfolioTransactionsUseCase(
    shared.identityStore,
    shared.identityStore
  );
  const recordPortfolioTransactionUseCase = new RecordPortfolioTransactionUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService
  );
  const listPortfolioPositionsUseCase = new ListPortfolioPositionsUseCase(
    shared.identityStore,
    shared.identityStore
  );
  const listPortfolioSnapshotsUseCase = new ListPortfolioSnapshotsUseCase(
    shared.identityStore,
    shared.identityStore
  );
  const controller = new PortfolioController(
    listVisiblePortfoliosUseCase,
    createPortfolioUseCase,
    getPortfolioDetailUseCase,
    updatePortfolioUseCase,
    listPortfolioTransactionsUseCase,
    recordPortfolioTransactionUseCase,
    listPortfolioPositionsUseCase,
    listPortfolioSnapshotsUseCase
  );

  return {
    controller,
    useCases: {
      listVisiblePortfoliosUseCase,
      createPortfolioUseCase,
      getPortfolioDetailUseCase,
      updatePortfolioUseCase,
      listPortfolioTransactionsUseCase,
      recordPortfolioTransactionUseCase,
      listPortfolioPositionsUseCase,
      listPortfolioSnapshotsUseCase
    }
  };
}
