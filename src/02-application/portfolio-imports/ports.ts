import { Readable } from "stream";
import {
  ParsedPortfolioImportWorkbook,
  PortfolioImportJob,
  PortfolioImportRowError
} from "../../01-domain/portfolio-imports/portfolio-import";

export interface PortfolioImportRepository {
  create(job: PortfolioImportJob): Promise<PortfolioImportJob>;
  findById(id: string): Promise<PortfolioImportJob | undefined>;
  findByIdempotencyKey(
    requestedBy: string,
    accountId: string,
    idempotencyKey: string
  ): Promise<PortfolioImportJob | undefined>;
  list(
    accountId: string,
    page: number,
    perPage: number,
    status?: string
  ): Promise<{
    jobs: PortfolioImportJob[];
    totalItems: number;
  }>;
  update(id: string, changes: Partial<PortfolioImportJob>): Promise<PortfolioImportJob | undefined>;
}

export interface PortfolioImportStorage {
  put(key: string, content: Buffer | Readable, mediaType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export interface PortfolioImportQueue {
  enqueue(message: { jobId: string; accountId: string }): Promise<void>;
  dequeue(): Promise<PortfolioImportQueueMessage | undefined>;
  acknowledge(message: PortfolioImportQueueMessage): Promise<void>;
  deadLetter(
    message: PortfolioImportQueueMessage,
    details: { accountId: string; reason: string }
  ): Promise<void>;
}

export interface PortfolioImportQueueMessage {
  jobId: string;
  receiptHandle: string;
}

export interface PortfolioImportWorkbookService {
  createTemplate(): Promise<Buffer>;
  parse(content: Buffer): Promise<ParsedPortfolioImportWorkbook>;
  createErrorReport(errors: PortfolioImportRowError[], source?: Buffer): Promise<Buffer>;
}
