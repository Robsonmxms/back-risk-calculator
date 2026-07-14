import serverless from "serverless-http";
import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { createApp } from "../app";

const serverlessAppPromise = createApp().then(({ app }) => serverless(app));

export async function handler(event: APIGatewayProxyEventV2, context: Context) {
  const serverlessApp = await serverlessAppPromise;
  return serverlessApp(event, context);
}
