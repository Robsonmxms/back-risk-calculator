import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("serverless handler", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      ACCESS_TOKEN_SECRET: "lambda-test-secret",
      CORS_ALLOWED_ORIGINS: "https://app.example.com",
      GOOGLE_OAUTH_MOCK_TOKENS: "false",
      NODE_ENV: "staging"
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("handles API Gateway proxy health checks from compiled-handler entrypoint", async () => {
    const { handler } = await import("../../src/04-infra/serverless.js");
    const context = createContext();

    const response = (await handler(
      createEvent("GET", "/health", { origin: "https://app.example.com" }),
      context
    )) as APIGatewayProxyResult;

    expect(context.callbackWaitsForEmptyEventLoop).toBe(false);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
    expect(response.headers).toMatchObject({
      "access-control-allow-origin": "https://app.example.com",
      vary: "Origin"
    });
  });

  it("returns preflight CORS headers only for configured production origins", async () => {
    const { handler } = await import("../../src/04-infra/serverless.js");

    const allowed = (await handler(
      createEvent("OPTIONS", "/api/v1/users/me", {
        origin: "https://app.example.com",
        "access-control-request-method": "GET"
      }),
      createContext()
    )) as APIGatewayProxyResult;
    const denied = (await handler(
      createEvent("OPTIONS", "/api/v1/users/me", {
        origin: "https://evil.example.com",
        "access-control-request-method": "GET"
      }),
      createContext()
    )) as APIGatewayProxyResult;

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers).toMatchObject({
      "access-control-allow-origin": "https://app.example.com"
    });
    expect(denied.statusCode).toBe(204);
    expect(denied.headers?.["access-control-allow-origin"]).toBeUndefined();
  });
});

function createEvent(
  httpMethod: string,
  path: string,
  headers: Record<string, string> = {}
): APIGatewayProxyEvent {
  return {
    body: null,
    headers,
    httpMethod,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path,
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: path,
    stageVariables: null
  };
}

function createContext(): Context {
  return {
    awsRequestId: "lambda-test-request",
    callbackWaitsForEmptyEventLoop: true,
    clientContext: undefined,
    done: vi.fn(),
    fail: vi.fn(),
    functionName: "back-risk-calculator-api",
    functionVersion: "$LATEST",
    getRemainingTimeInMillis: () => 30_000,
    invokedFunctionArn: "arn:aws:lambda:us-east-1:000000000000:function:test",
    logGroupName: "/aws/lambda/back-risk-calculator-api",
    logStreamName: "2026/07/28/[$LATEST]test",
    memoryLimitInMB: "1024",
    succeed: vi.fn()
  };
}
