import { AnalyticsRepository } from "../../modules/analytics/ports";
import { AnalyticsJob, PortfolioAnalyticsSnapshot } from "../../modules/analytics/types";

export class InMemoryAnalyticsStore implements AnalyticsRepository {
  private readonly jobs = new Map<string, AnalyticsJob>();
  private readonly snapshotsById = new Map<string, PortfolioAnalyticsSnapshot>();
  private readonly snapshotIdByEffectiveKey = new Map<string, string>();

  async enqueue(job: AnalyticsJob): Promise<AnalyticsJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  async nextQueued(): Promise<AnalyticsJob | undefined> {
    return Array.from(this.jobs.values())
      .filter((job) => job.status === "queued")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
  }

  async markRunning(jobId: string, updatedAt: Date): Promise<AnalyticsJob | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    job.status = "running";
    job.attempts += 1;
    job.updatedAt = updatedAt;
    return job;
  }

  async markSucceeded(jobId: string, completedAt: Date): Promise<AnalyticsJob | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    job.status = "succeeded";
    job.updatedAt = completedAt;
    job.completedAt = completedAt;
    return job;
  }

  async markFailed(
    jobId: string,
    completedAt: Date,
    errorCode: string
  ): Promise<AnalyticsJob | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    job.status = "failed";
    job.updatedAt = completedAt;
    job.completedAt = completedAt;
    job.errorCode = errorCode;
    return job;
  }

  async findLatestJob(portfolioId: string): Promise<AnalyticsJob | undefined> {
    return Array.from(this.jobs.values())
      .filter((job) => job.portfolioId === portfolioId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
  }

  async listJobs(): Promise<AnalyticsJob[]> {
    return [...this.jobs.values()];
  }

  async saveSnapshot(snapshot: PortfolioAnalyticsSnapshot): Promise<PortfolioAnalyticsSnapshot> {
    const key = this.effectiveSnapshotKey(snapshot);
    const existingId = this.snapshotIdByEffectiveKey.get(key);
    if (existingId) {
      return this.snapshotsById.get(existingId) ?? snapshot;
    }

    this.snapshotsById.set(snapshot.id, snapshot);
    this.snapshotIdByEffectiveKey.set(key, snapshot.id);
    return snapshot;
  }

  async findLatestSnapshot(portfolioId: string): Promise<PortfolioAnalyticsSnapshot | undefined> {
    return (await this.listSnapshots(portfolioId))[0];
  }

  async listSnapshots(portfolioId: string): Promise<PortfolioAnalyticsSnapshot[]> {
    return Array.from(this.snapshotsById.values())
      .filter((snapshot) => snapshot.portfolioId === portfolioId)
      .sort((left, right) => right.generatedAt.getTime() - left.generatedAt.getTime());
  }

  private effectiveSnapshotKey(snapshot: PortfolioAnalyticsSnapshot): string {
    return `${snapshot.portfolioId}:${snapshot.asOfDate}:${snapshot.inputHash}`;
  }
}
