import { randomUUID } from "crypto";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient
} from "@aws-sdk/client-sqs";
import {
  PortfolioImportQueue,
  PortfolioImportQueueMessage
} from "../../02-application/portfolio-imports/ports";

interface PortfolioImportSqsPayload {
  version: 1;
  type: "portfolio_import.requested";
  jobId: string;
  accountId: string;
}

export interface SqsPortfolioImportQueueOptions {
  queueUrl: string;
  deadLetterQueueUrl: string;
  waitTimeSeconds?: number;
  visibilityTimeoutSeconds?: number;
}

export class SqsPortfolioImportQueue implements PortfolioImportQueue {
  constructor(
    private readonly client: Pick<SQSClient, "send">,
    private readonly options: SqsPortfolioImportQueueOptions
  ) {}

  async enqueue(message: { jobId: string; accountId: string }): Promise<void> {
    await this.send(this.options.queueUrl, {
      version: 1,
      type: "portfolio_import.requested",
      jobId: message.jobId,
      accountId: message.accountId
    });
  }

  async dequeue(): Promise<PortfolioImportQueueMessage | undefined> {
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: this.options.waitTimeSeconds ?? 0,
        VisibilityTimeout: this.options.visibilityTimeoutSeconds ?? 120,
        MessageAttributeNames: ["All"]
      })
    );
    const message = result.Messages?.[0];
    if (!message?.Body || !message.ReceiptHandle) {
      return undefined;
    }
    const payload = parsePayload(message.Body);
    return {
      jobId: payload.jobId,
      receiptHandle: message.ReceiptHandle
    };
  }

  async acknowledge(message: PortfolioImportQueueMessage): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.options.queueUrl,
        ReceiptHandle: message.receiptHandle
      })
    );
  }

  async deadLetter(
    message: PortfolioImportQueueMessage,
    details: { accountId: string; reason: string }
  ): Promise<void> {
    await this.send(
      this.options.deadLetterQueueUrl,
      {
        version: 1,
        type: "portfolio_import.requested",
        jobId: message.jobId,
        accountId: details.accountId
      },
      details.reason
    );
  }

  private async send(
    queueUrl: string,
    payload: PortfolioImportSqsPayload,
    failureReason?: string
  ): Promise<void> {
    const isFifo = queueUrl.endsWith(".fifo");
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
        MessageAttributes: failureReason
          ? {
              failureReason: {
                DataType: "String",
                StringValue: failureReason
              }
            }
          : undefined,
        MessageGroupId: isFifo ? payload.accountId : undefined,
        MessageDeduplicationId: isFifo ? randomUUID() : undefined
      })
    );
  }
}

function parsePayload(body: string): PortfolioImportSqsPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("portfolio_import.queue_invalid_message");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as Partial<PortfolioImportSqsPayload>).version !== 1 ||
    (payload as Partial<PortfolioImportSqsPayload>).type !== "portfolio_import.requested" ||
    typeof (payload as Partial<PortfolioImportSqsPayload>).jobId !== "string" ||
    typeof (payload as Partial<PortfolioImportSqsPayload>).accountId !== "string"
  ) {
    throw new Error("portfolio_import.queue_invalid_message");
  }
  return payload as PortfolioImportSqsPayload;
}
