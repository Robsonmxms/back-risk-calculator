import {
  AnalystChartJob,
  AnalystChartJobRepository
} from "../../02-application/analytics/analyst-chart-types";

export class InMemoryAnalystChartJobStore implements AnalystChartJobRepository {
  private readonly jobs = new Map<string, AnalystChartJob>();
  private readonly idempotencyIndex = new Map<string, string>();

  async createJob(job: AnalystChartJob): Promise<AnalystChartJob> {
    this.jobs.set(job.id, copyJob(job));
    this.idempotencyIndex.set(
      this.idempotencyKey(job.officeId, job.requestedBy, job.idempotencyKey),
      job.id
    );
    return copyJob(job);
  }

  async findJobById(jobId: string): Promise<AnalystChartJob | undefined> {
    const job = this.jobs.get(jobId);
    return job ? copyJob(job) : undefined;
  }

  async findJobByIdempotencyKey(
    officeId: string,
    requestedBy: string,
    idempotencyKey: string
  ): Promise<AnalystChartJob | undefined> {
    const jobId = this.idempotencyIndex.get(
      this.idempotencyKey(officeId, requestedBy, idempotencyKey)
    );
    return jobId ? this.findJobById(jobId) : undefined;
  }

  async updateJob(
    jobId: string,
    input: Partial<
      Pick<
        AnalystChartJob,
        | "status"
        | "progressPercent"
        | "sourceSnapshotIds"
        | "resultMetadata"
        | "errorCode"
        | "updatedAt"
        | "completedAt"
        | "expiresAt"
      >
    >
  ): Promise<AnalystChartJob | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    Object.assign(job, {
      ...input,
      sourceSnapshotIds: input.sourceSnapshotIds
        ? [...input.sourceSnapshotIds]
        : job.sourceSnapshotIds,
      resultMetadata: input.resultMetadata ? { ...input.resultMetadata } : job.resultMetadata
    });
    return copyJob(job);
  }

  async listJobsByOffice(officeId: string): Promise<AnalystChartJob[]> {
    return Array.from(this.jobs.values())
      .filter((job) => job.officeId === officeId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map(copyJob);
  }

  private idempotencyKey(officeId: string, requestedBy: string, idempotencyKey: string): string {
    return `${officeId}:${requestedBy}:${idempotencyKey}`;
  }
}

function copyJob(job: AnalystChartJob): AnalystChartJob {
  return {
    ...job,
    filters: { ...job.filters },
    sourceSnapshotIds: [...job.sourceSnapshotIds],
    resultMetadata: job.resultMetadata ? { ...job.resultMetadata } : undefined
  };
}
