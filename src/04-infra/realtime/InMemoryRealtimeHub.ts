import { randomUUID } from "crypto";
import { Response } from "express";
import { Actor } from "../../01-domain/auth/actor";
import { MetricsPort } from "../../02-application/ports/observability";
import { RealtimeRepository } from "../../modules/reports-alerts/ports";
import { RealtimeMessage, RealtimeMessageType } from "../../modules/reports-alerts/types";

interface RealtimeClient {
  id: string;
  actor: Actor;
  response: Response;
  portfolioId?: string;
}

const TOPIC_TO_MESSAGE_TYPE: Record<string, RealtimeMessageType | undefined> = {
  AnalyticsUpdated: "analytics.updated",
  AnalyticsFailed: "analytics.failed",
  MarketDataUpdated: "market_data.updated",
  MarketDataFailed: "market_data.failed",
  ReportGenerated: "report.generated",
  ReportFailed: "report.failed",
  NotificationSent: "notification.sent",
  PortfolioUpdated: "portfolio.updated",
  TransactionRecorded: "portfolio.updated"
};

export class InMemoryRealtimeHub {
  private readonly clients = new Map<string, RealtimeClient>();

  constructor(
    private readonly repository: RealtimeRepository,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  topicToMessageType(topic: string): RealtimeMessageType | undefined {
    return TOPIC_TO_MESSAGE_TYPE[topic];
  }

  async publishFromTopic(
    topic: string,
    aggregateId: string,
    payload: Record<string, unknown>
  ): Promise<RealtimeMessage[]> {
    const type = this.topicToMessageType(topic);
    if (!type) {
      return [];
    }

    const portfolioIds = Array.isArray(payload.portfolioIds)
      ? payload.portfolioIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (portfolioIds.length > 0) {
      return Promise.all(
        portfolioIds.map((portfolioId) =>
          this.publish({
            id: randomUUID(),
            type,
            portfolioId,
            userId: typeof payload.userId === "string" ? payload.userId : undefined,
            payload: { ...payload, portfolioId },
            createdAt: this.now()
          })
        )
      );
    }

    const portfolioId =
      typeof payload.portfolioId === "string"
        ? payload.portfolioId
        : topic.startsWith("Portfolio") || topic.startsWith("Transaction")
          ? aggregateId
          : undefined;
    return [
      await this.publish({
        id: randomUUID(),
        type,
        portfolioId,
        userId: typeof payload.userId === "string" ? payload.userId : undefined,
        payload,
        createdAt: this.now()
      })
    ];
  }

  async publish(message: RealtimeMessage): Promise<RealtimeMessage> {
    const saved = await this.repository.saveRealtimeMessage(message);
    this.metrics.increment("realtime.message.published");
    for (const client of this.clients.values()) {
      if (!this.canReceive(client, saved)) {
        continue;
      }
      client.response.write(`event: ${saved.type}\n`);
      client.response.write(`data: ${JSON.stringify(this.serialize(saved))}\n\n`);
    }
    return saved;
  }

  subscribe(actor: Actor, response: Response, portfolioId?: string): string {
    const id = randomUUID();
    this.clients.set(id, { id, actor, response, portfolioId });
    this.metrics.increment("realtime.connection.opened");

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();
    response.write("event: connected\n");
    response.write(`data: ${JSON.stringify({ actorId: actor.id, portfolioId })}\n\n`);

    response.on("close", () => {
      this.clients.delete(id);
      this.metrics.increment("realtime.connection.closed");
    });

    return id;
  }

  private canReceive(client: RealtimeClient, message: RealtimeMessage): boolean {
    if (client.portfolioId && message.portfolioId !== client.portfolioId) {
      return false;
    }
    if (message.userId && message.userId !== client.actor.id) {
      return false;
    }
    return true;
  }

  private serialize(message: RealtimeMessage) {
    return {
      ...message,
      createdAt: message.createdAt.toISOString()
    };
  }
}
