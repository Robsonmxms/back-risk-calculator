import { MarketDataController } from "../../03-adapters/controllers/MarketDataController";
import { BrapiMarketDataProvider } from "../providers/market-data/BrapiMarketDataProvider";
import { InMemoryMarketDataCache } from "../repositories/InMemoryMarketDataCache";
import { InMemoryMarketDataStore } from "../repositories/InMemoryMarketDataStore";
import {
  GetMarketAssetUseCase,
  GetMarketDataProviderStatusUseCase,
  RequestMarketDataRefreshUseCase,
  SearchMarketAssetsUseCase
} from "../../modules/market-data/use-cases";
import { MarketDataScheduler, MarketDataIngestionWorker } from "../../modules/market-data/worker";
import {
  MarketDataCache,
  MarketDataEventPublisher,
  MarketDataJobQueue,
  MarketDataProvider,
  MarketDataRepository
} from "../../modules/market-data/ports";
import type { SharedContainer } from "./SharedContainer";

export interface MarketDataContainerDependencies {
  marketDataProvider?: MarketDataProvider;
  marketDataRepository?: MarketDataRepository;
  marketDataCache?: MarketDataCache;
  marketDataJobQueue?: MarketDataJobQueue;
  marketDataEventPublisher?: MarketDataEventPublisher;
  marketDataNow?: () => Date;
}

export interface MarketDataContainer {
  controller: MarketDataController;
  worker: MarketDataIngestionWorker;
  scheduler: MarketDataScheduler;
  repository: MarketDataRepository;
  cache: MarketDataCache;
  queue: MarketDataJobQueue;
  useCases: {
    searchAssetsUseCase: SearchMarketAssetsUseCase;
    getAssetUseCase: GetMarketAssetUseCase;
    requestRefreshUseCase: RequestMarketDataRefreshUseCase;
    getProviderStatusUseCase: GetMarketDataProviderStatusUseCase;
  };
}

export function buildMarketDataContainer(
  shared: SharedContainer,
  dependencies: MarketDataContainerDependencies = {}
): MarketDataContainer {
  const now = dependencies.marketDataNow ?? (() => new Date());
  const provider = dependencies.marketDataProvider ?? new BrapiMarketDataProvider(now);
  const store = new InMemoryMarketDataStore(now);
  const repository = dependencies.marketDataRepository ?? store;
  const queue = dependencies.marketDataJobQueue ?? store;
  const cache = dependencies.marketDataCache ?? new InMemoryMarketDataCache(now);
  const events =
    dependencies.marketDataEventPublisher ??
    ({
      publish: async (topic, aggregateId, payload) => {
        await shared.identityStore.appendOutboxEvent(topic, aggregateId, payload);
      }
    } satisfies MarketDataEventPublisher);

  const searchAssetsUseCase = new SearchMarketAssetsUseCase(
    provider,
    repository,
    shared.metrics,
    now
  );
  const getAssetUseCase = new GetMarketAssetUseCase(repository);
  const requestRefreshUseCase = new RequestMarketDataRefreshUseCase(
    repository,
    queue,
    events,
    now
  );
  const getProviderStatusUseCase = new GetMarketDataProviderStatusUseCase(repository, provider);
  const worker = new MarketDataIngestionWorker(
    provider,
    repository,
    cache,
    queue,
    events,
    shared.identityStore,
    shared.logger,
    shared.metrics,
    now
  );
  const scheduler = new MarketDataScheduler(shared.identityStore, repository, queue, now);
  const controller = new MarketDataController(
    searchAssetsUseCase,
    getAssetUseCase,
    requestRefreshUseCase,
    getProviderStatusUseCase
  );

  return {
    controller,
    worker,
    scheduler,
    repository,
    cache,
    queue,
    useCases: {
      searchAssetsUseCase,
      getAssetUseCase,
      requestRefreshUseCase,
      getProviderStatusUseCase
    }
  };
}
