import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand
} from "@aws-sdk/client-sqs";
import { describe, expect, it, vi } from "vitest";
import { SqsPortfolioImportQueue } from "../../src/04-infra/portfolio-imports/SqsPortfolioImportQueue";

describe("SqsPortfolioImportQueue", () => {
  it("publishes versioned FIFO messages grouped by account", async () => {
    const send = vi.fn().mockResolvedValue({});
    const queue = createQueue(send);

    await queue.enqueue({ jobId: "job-1", accountId: "account-1" });

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input).toMatchObject({
      QueueUrl: SOURCE_URL,
      MessageGroupId: "account-1"
    });
    expect(JSON.parse(command.input.MessageBody!)).toEqual({
      version: 1,
      type: "portfolio_import.requested",
      jobId: "job-1",
      accountId: "account-1"
    });
  });

  it("receives and acknowledges a job only through its receipt handle", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          {
            Body: JSON.stringify({
              version: 1,
              type: "portfolio_import.requested",
              jobId: "job-2",
              accountId: "account-2"
            }),
            ReceiptHandle: "receipt-2"
          }
        ]
      })
      .mockResolvedValueOnce({});
    const queue = createQueue(send);

    const message = await queue.dequeue();
    expect(send.mock.calls[0][0]).toBeInstanceOf(ReceiveMessageCommand);
    expect(message).toEqual({ jobId: "job-2", receiptHandle: "receipt-2" });

    await queue.acknowledge(message!);
    expect(send.mock.calls[1][0]).toBeInstanceOf(DeleteMessageCommand);
    expect(send.mock.calls[1][0].input).toMatchObject({
      QueueUrl: SOURCE_URL,
      ReceiptHandle: "receipt-2"
    });
  });

  it("publishes exhausted technical failures to the configured DLQ", async () => {
    const send = vi.fn().mockResolvedValue({});
    const queue = createQueue(send);

    await queue.deadLetter(
      { jobId: "job-3", receiptHandle: "receipt-3" },
      { accountId: "account-3", reason: "portfolio_import.processing_failed" }
    );

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input).toMatchObject({
      QueueUrl: DLQ_URL,
      MessageGroupId: "account-3",
      MessageAttributes: {
        failureReason: {
          DataType: "String",
          StringValue: "portfolio_import.processing_failed"
        }
      }
    });
  });

  it("rejects unversioned or malformed messages", async () => {
    const send = vi.fn().mockResolvedValue({
      Messages: [{ Body: "{}", ReceiptHandle: "receipt-invalid" }]
    });
    const queue = createQueue(send);

    await expect(queue.dequeue()).rejects.toThrow("portfolio_import.queue_invalid_message");
  });
});

const SOURCE_URL = "https://sqs.us-east-1.amazonaws.com/123/portfolio-imports.fifo";
const DLQ_URL = "https://sqs.us-east-1.amazonaws.com/123/portfolio-imports-dlq.fifo";

function createQueue(send: ReturnType<typeof vi.fn>) {
  return new SqsPortfolioImportQueue({ send } as never, {
    queueUrl: SOURCE_URL,
    deadLetterQueueUrl: DLQ_URL,
    waitTimeSeconds: 0,
    visibilityTimeoutSeconds: 60
  });
}
