import { AnalyticsController } from "../../03-adapters/controllers/AnalyticsController";
import { InMemoryAnalyticsStore } from "../repositories/InMemoryAnalyticsStore";
import {
  AnalyticsEventPublisher,
  AnalyticsPortfolioProjection,
  AnalyticsRepository
} from "../../modules/analytics/ports";
import {
  GetPortfolioAnalyticsUseCase,
  ListPortfolioAnalyticsHistoryUseCase,
  RequestPortfolioAnalyticsRecomputeUseCase
} from "../../modules/analytics/use-cases";
import { AnalyticsCalculationWorker } from "../../modules/analytics/worker";
import type { SharedContainer } from "./SharedContainer";
import type { MarketDataContainer } from "./MarketDataContainer";

export interface AnalyticsContainerDependencies {
  analyticsRepository?: AnalyticsRepository;
  analyticsEventPublisher?: AnalyticsEventPublisher;
  analyticsPortfolioProjection?: AnalyticsPortfolioProjection;
  analyticsNow?: () => Date;
}

export interface AnalyticsContainer {
  controller: AnalyticsController;
  worker: AnalyticsCalculationWorker;
  repository: AnalyticsRepository;
  useCases: {
    getPortfolioAnalyticsUseCase: GetPortfolioAnalyticsUseCase;
    requestPortfolioAnalyticsRecomputeUseCase: RequestPortfolioAnalyticsRecomputeUseCase;
    listPortfolioAnalyticsHistoryUseCase: ListPortfolioAnalyticsHistoryUseCase;
  };
}

export function buildAnalyticsContainer(
  shared: SharedContainer,
  marketData: MarketDataContainer,
  dependencies: AnalyticsContainerDependencies = {}
): AnalyticsContainer {
  const now = dependencies.analyticsNow ?? (() => new Date());
  const repository = dependencies.analyticsRepository ?? new InMemoryAnalyticsStore();
  const events =
    dependencies.analyticsEventPublisher ??
    ({
      publish: async (topic, aggregateId, payload) => {
        await shared.identityStore.appendOutboxEvent(topic, aggregateId, payload);
      }
    } satisfies AnalyticsEventPublisher);
  const portfolioProjection =
    dependencies.analyticsPortfolioProjection ?? shared.identityStore;

  const getPortfolioAnalyticsUseCase = new GetPortfolioAnalyticsUseCase(
    shared.identityStore,
    shared.identityStore,
    repository
  );
  const requestPortfolioAnalyticsRecomputeUseCase =
    new RequestPortfolioAnalyticsRecomputeUseCase(
      shared.identityStore,
      shared.identityStore,
      repository,
      events,
      now
    );
  const listPortfolioAnalyticsHistoryUseCase =
    new ListPortfolioAnalyticsHistoryUseCase(
      shared.identityStore,
      shared.identityStore,
      repository
    );
  const worker = new AnalyticsCalculationWorker(
    repository,
    shared.identityStore,
    marketData.repository,
    marketData.provider,
    marketData.currencyRateProvider,
    portfolioProjection,
    events,
    shared.logger,
    shared.metrics,
    now
  );
  const controller = new AnalyticsController(
    getPortfolioAnalyticsUseCase,
    requestPortfolioAnalyticsRecomputeUseCase,
    listPortfolioAnalyticsHistoryUseCase
  );

  return {
    controller,
    worker,
    repository,
    useCases: {
      getPortfolioAnalyticsUseCase,
      requestPortfolioAnalyticsRecomputeUseCase,
      listPortfolioAnalyticsHistoryUseCase
    }
  };
}
