import { MarketDataController } from "../../03-adapters/controllers/MarketDataController";
import { YahooFinanceMarketDataProvider } from "../providers/market-data/YahooFinanceMarketDataProvider";
import { InMemoryMarketDataCache } from "../repositories/InMemoryMarketDataCache";
import { InMemoryMarketDataStore } from "../repositories/InMemoryMarketDataStore";
import {
  ConvertCurrencyUseCase,
  GetAssetHistoryUseCase,
  GetMarketAssetUseCase,
  GetMarketDataProviderStatusUseCase,
  GetTradePriceUseCase,
  ListMarketExchangesUseCase,
  RequestMarketDataRefreshUseCase,
  SearchMarketAssetsUseCase
} from "../../modules/market-data/use-cases";
import { MarketDataScheduler, MarketDataIngestionWorker } from "../../modules/market-data/worker";
import {
  CurrencyRateProvider,
  MarketDataCache,
  MarketDataEventPublisher,
  MarketDataJobQueue,
  MarketDataProvider,
  MarketDataRepository
} from "../../modules/market-data/ports";
import type { SharedContainer } from "./SharedContainer";

export interface MarketDataContainerDependencies {
  marketDataProvider?: MarketDataProvider;
  currencyRateProvider?: CurrencyRateProvider;
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
  provider: MarketDataProvider;
  currencyRateProvider: CurrencyRateProvider;
  useCases: {
    searchAssetsUseCase: SearchMarketAssetsUseCase;
    getAssetUseCase: GetMarketAssetUseCase;
    requestRefreshUseCase: RequestMarketDataRefreshUseCase;
    getProviderStatusUseCase: GetMarketDataProviderStatusUseCase;
    convertCurrencyUseCase: ConvertCurrencyUseCase;
    listMarketExchangesUseCase: ListMarketExchangesUseCase;
    getTradePriceUseCase: GetTradePriceUseCase;
    getAssetHistoryUseCase: GetAssetHistoryUseCase;
  };
}

export function buildMarketDataContainer(
  shared: SharedContainer,
  dependencies: MarketDataContainerDependencies = {}
): MarketDataContainer {
  const now = dependencies.marketDataNow ?? (() => new Date());
  const defaultProvider = new YahooFinanceMarketDataProvider(now);
  const provider = dependencies.marketDataProvider ?? defaultProvider;
  const currencyRateProvider =
    dependencies.currencyRateProvider ?? (provider as MarketDataProvider & CurrencyRateProvider);
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
  const requestRefreshUseCase = new RequestMarketDataRefreshUseCase(repository, queue, events, now);
  const getProviderStatusUseCase = new GetMarketDataProviderStatusUseCase(repository, provider);
  const listMarketExchangesUseCase = new ListMarketExchangesUseCase();
  const convertCurrencyUseCase = new ConvertCurrencyUseCase(
    currencyRateProvider,
    repository,
    shared.metrics,
    shared.logger,
    now
  );
  const getTradePriceUseCase = new GetTradePriceUseCase(provider, repository, shared.metrics, now);
  const getAssetHistoryUseCase = new GetAssetHistoryUseCase(repository);
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
    getProviderStatusUseCase,
    convertCurrencyUseCase,
    listMarketExchangesUseCase,
    getTradePriceUseCase,
    getAssetHistoryUseCase
  );

  return {
    controller,
    worker,
    scheduler,
    repository,
    cache,
    queue,
    provider,
    currencyRateProvider,
    useCases: {
      searchAssetsUseCase,
      getAssetUseCase,
      requestRefreshUseCase,
      getProviderStatusUseCase,
      convertCurrencyUseCase,
      listMarketExchangesUseCase,
      getTradePriceUseCase,
      getAssetHistoryUseCase
    }
  };
}
