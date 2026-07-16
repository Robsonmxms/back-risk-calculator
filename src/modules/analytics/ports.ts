import { AnalyticsJob, PortfolioAnalyticsSnapshot } from "./types";

export interface AnalyticsRepository {
  enqueue(job: AnalyticsJob): Promise<AnalyticsJob>;
  nextQueued(): Promise<AnalyticsJob | undefined>;
  markRunning(jobId: string, updatedAt: Date): Promise<AnalyticsJob | undefined>;
  markSucceeded(jobId: string, completedAt: Date): Promise<AnalyticsJob | undefined>;
  markFailed(
    jobId: string,
    completedAt: Date,
    errorCode: string
  ): Promise<AnalyticsJob | undefined>;
  findLatestJob(portfolioId: string): Promise<AnalyticsJob | undefined>;
  listJobs(): Promise<AnalyticsJob[]>;
  saveSnapshot(snapshot: PortfolioAnalyticsSnapshot): Promise<PortfolioAnalyticsSnapshot>;
  findLatestSnapshot(portfolioId: string): Promise<PortfolioAnalyticsSnapshot | undefined>;
  listSnapshots(portfolioId: string): Promise<PortfolioAnalyticsSnapshot[]>;
}

export interface AnalyticsEventPublisher {
  publish(topic: string, aggregateId: string, payload: Record<string, unknown>): Promise<void>;
}

export interface AnalyticsPortfolioProjection {
  markAnalyticsSucceeded(portfolioId: string, refreshedAt: Date): Promise<void>;
  markAnalyticsFailed(portfolioId: string, errorCode: string, failedAt: Date): Promise<void>;
}
