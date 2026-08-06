import { Readable } from "stream";
import { PortfolioImportJob } from "../../01-domain/portfolio-imports/portfolio-import";
import {
  PortfolioImportQueue,
  PortfolioImportQueueMessage,
  PortfolioImportRepository,
  PortfolioImportStorage
} from "../../02-application/portfolio-imports/ports";

export class InMemoryPortfolioImportRepository implements PortfolioImportRepository {
  private readonly jobs = new Map<string, PortfolioImportJob>();

  async create(job: PortfolioImportJob): Promise<PortfolioImportJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  async findById(id: string): Promise<PortfolioImportJob | undefined> {
    return this.jobs.get(id);
  }

  async findByIdempotencyKey(
    requestedBy: string,
    accountId: string,
    idempotencyKey: string
  ): Promise<PortfolioImportJob | undefined> {
    return Array.from(this.jobs.values()).find(
      (job) =>
        job.requestedBy === requestedBy &&
        job.accountId === accountId &&
        job.idempotencyKey === idempotencyKey
    );
  }

  async list(accountId: string, page: number, perPage: number, status?: string) {
    const filtered = Array.from(this.jobs.values())
      .filter((job) => job.accountId === accountId && (!status || job.status === status))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const start = (page - 1) * perPage;
    return {
      jobs: filtered.slice(start, start + perPage),
      totalItems: filtered.length
    };
  }

  async update(
    id: string,
    changes: Partial<PortfolioImportJob>
  ): Promise<PortfolioImportJob | undefined> {
    const current = this.jobs.get(id);
    if (!current) {
      return undefined;
    }
    const updated = { ...current, ...changes };
    this.jobs.set(id, updated);
    return updated;
  }
}

export class InMemoryPortfolioImportStorage implements PortfolioImportStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, content: Buffer | Readable, _mediaType: string): Promise<void> {
    this.objects.set(key, Buffer.isBuffer(content) ? Buffer.from(content) : await readAll(content));
  }

  async get(key: string): Promise<Buffer> {
    const content = this.objects.get(key);
    if (!content) {
      throw new Error("portfolio_import.source_not_found");
    }
    return Buffer.from(content);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export class InMemoryPortfolioImportQueue implements PortfolioImportQueue {
  private readonly messages: PortfolioImportQueueMessage[] = [];

  async enqueue(message: { jobId: string; accountId: string }): Promise<void> {
    this.messages.push({ jobId: message.jobId, receiptHandle: message.jobId });
  }

  async dequeue(): Promise<PortfolioImportQueueMessage | undefined> {
    return this.messages.shift();
  }

  async acknowledge(_message: PortfolioImportQueueMessage): Promise<void> {
    return undefined;
  }

  async deadLetter(
    _message: PortfolioImportQueueMessage,
    _details: { accountId: string; reason: string }
  ): Promise<void> {
    return undefined;
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
