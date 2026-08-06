import { ReportsAlertsController } from "../../03-adapters/controllers/ReportsAlertsController";
import { InMemoryRealtimeHub } from "../realtime/InMemoryRealtimeHub";
import { InMemoryReportsAlertsStore } from "../repositories/InMemoryReportsAlertsStore";
import {
  AlertRepository,
  ApplicationEventPublisher,
  NotificationRepository,
  RealtimeRepository,
  ReportRepository,
  ReportStorage
} from "../../modules/reports-alerts/ports";
import {
  AuthorizeRealtimeSubscriptionUseCase,
  CreateAlertUseCase,
  DownloadReportUseCase,
  ListAlertsUseCase,
  ListNotificationsUseCase,
  ListReportsUseCase,
  MarkNotificationReadUseCase,
  RequestReportUseCase,
  UpdateAlertUseCase
} from "../../modules/reports-alerts/use-cases";
import { AlertEvaluationWorker, ReportGenerationWorker } from "../../modules/reports-alerts/worker";
import type { SharedContainer } from "./SharedContainer";

export interface ReportsAlertsContainerDependencies {
  reportRepository?: ReportRepository;
  reportStorage?: ReportStorage;
  alertRepository?: AlertRepository;
  notificationRepository?: NotificationRepository;
  realtimeRepository?: RealtimeRepository;
  reportsAlertsNow?: () => Date;
}

export interface ReportsAlertsContainer {
  controller: ReportsAlertsController;
  reportWorker: ReportGenerationWorker;
  alertEvaluator: AlertEvaluationWorker;
  eventPublisher: ApplicationEventPublisher;
  realtimeHub: InMemoryRealtimeHub;
  repository: InMemoryReportsAlertsStore | ReportRepository;
  alertRepository: AlertRepository;
  notificationRepository: NotificationRepository;
  useCases: {
    requestReportUseCase: RequestReportUseCase;
    listReportsUseCase: ListReportsUseCase;
    downloadReportUseCase: DownloadReportUseCase;
    listAlertsUseCase: ListAlertsUseCase;
    createAlertUseCase: CreateAlertUseCase;
    updateAlertUseCase: UpdateAlertUseCase;
    listNotificationsUseCase: ListNotificationsUseCase;
    markNotificationReadUseCase: MarkNotificationReadUseCase;
    authorizeRealtimeSubscriptionUseCase: AuthorizeRealtimeSubscriptionUseCase;
  };
}

export function buildReportsAlertsContainer(
  shared: SharedContainer,
  dependencies: ReportsAlertsContainerDependencies = {}
): ReportsAlertsContainer {
  const now = dependencies.reportsAlertsNow ?? (() => new Date());
  const store = new InMemoryReportsAlertsStore();
  const reports = dependencies.reportRepository ?? store;
  const storage = dependencies.reportStorage ?? store;
  const alerts = dependencies.alertRepository ?? store;
  const notifications = dependencies.notificationRepository ?? store;
  const realtimeRepository = dependencies.realtimeRepository ?? store;
  const realtimeHub = new InMemoryRealtimeHub(realtimeRepository, shared.metrics, now);

  const eventPublisher: ApplicationEventPublisher = {
    publish: async (topic, aggregateId, payload) => {
      await shared.identityStore.appendOutboxEvent(topic, aggregateId, payload);
      const realtimeMessages = await realtimeHub.publishFromTopic(topic, aggregateId, payload);
      for (const realtimeMessage of realtimeMessages) {
        if (!realtimeMessage.portfolioId) {
          continue;
        }
        await alertEvaluator.evaluatePortfolioEvent(
          realtimeMessage.portfolioId,
          realtimeMessage.type,
          payload
        );
      }
    }
  };

  const alertEvaluator = new AlertEvaluationWorker(
    alerts,
    notifications,
    eventPublisher,
    shared.metrics,
    now
  );

  const requestReportUseCase = new RequestReportUseCase(
    shared.identityStore,
    shared.identityStore,
    reports,
    eventPublisher,
    now
  );
  const listReportsUseCase = new ListReportsUseCase(
    shared.identityStore,
    shared.identityStore,
    reports
  );
  const downloadReportUseCase = new DownloadReportUseCase(
    shared.identityStore,
    shared.identityStore,
    reports,
    storage
  );
  const listAlertsUseCase = new ListAlertsUseCase(
    shared.identityStore,
    shared.identityStore,
    alerts
  );
  const createAlertUseCase = new CreateAlertUseCase(
    shared.identityStore,
    shared.identityStore,
    alerts,
    now
  );
  const updateAlertUseCase = new UpdateAlertUseCase(
    shared.identityStore,
    shared.identityStore,
    alerts,
    now
  );
  const listNotificationsUseCase = new ListNotificationsUseCase(
    shared.identityStore,
    notifications
  );
  const markNotificationReadUseCase = new MarkNotificationReadUseCase(
    shared.identityStore,
    notifications,
    now
  );
  const authorizeRealtimeSubscriptionUseCase = new AuthorizeRealtimeSubscriptionUseCase(
    shared.identityStore,
    shared.identityStore
  );
  const reportWorker = new ReportGenerationWorker(
    reports,
    storage,
    notifications,
    eventPublisher,
    shared.identityStore,
    shared.logger,
    shared.metrics,
    now
  );
  const controller = new ReportsAlertsController(
    requestReportUseCase,
    listReportsUseCase,
    downloadReportUseCase,
    listAlertsUseCase,
    createAlertUseCase,
    updateAlertUseCase,
    listNotificationsUseCase,
    markNotificationReadUseCase,
    authorizeRealtimeSubscriptionUseCase,
    realtimeHub
  );

  return {
    controller,
    reportWorker,
    alertEvaluator,
    eventPublisher,
    realtimeHub,
    repository: reports,
    alertRepository: alerts,
    notificationRepository: notifications,
    useCases: {
      requestReportUseCase,
      listReportsUseCase,
      downloadReportUseCase,
      listAlertsUseCase,
      createAlertUseCase,
      updateAlertUseCase,
      listNotificationsUseCase,
      markNotificationReadUseCase,
      authorizeRealtimeSubscriptionUseCase
    }
  };
}
