module.exports = {
  service: "back-risk-calculator",
  frameworkVersion: "3",
  plugins: ["serverless-offline"],
  provider: {
    name: "aws",
    runtime: "nodejs22.x",
    stage: "${opt:stage, 'dev'}",
    region: "us-east-1",
    environment: {
      NODE_ENV: "${self:provider.stage}",
      PORT: "${env:PORT, '8000'}",
      ACCESS_TOKEN_SECRET:
        "${env:ACCESS_TOKEN_SECRET, 'dev-only-change-me-risk-calculator-access-token-secret'}",
      ACCESS_TOKEN_TTL_SECONDS: "${env:ACCESS_TOKEN_TTL_SECONDS, '900'}",
      REFRESH_TOKEN_TTL_DAYS: "${env:REFRESH_TOKEN_TTL_DAYS, '30'}",
      GOOGLE_OAUTH_MOCK_TOKENS: "${env:GOOGLE_OAUTH_MOCK_TOKENS, 'true'}",
      DATABASE_URL:
        "${env:DATABASE_URL, 'postgres://risk_calculator:risk_calculator@127.0.0.1:5432/risk_calculator_dev'}"
    }
  },
  functions: {
    api: {
      handler: "src/04-infra/serverless-bootstrap.handler",
      events: [
        {
          http: {
            method: "any",
            path: "/"
          }
        },
        {
          http: {
            method: "any",
            path: "/{proxy+}"
          }
        }
      ]
    }
  },
  custom: {
    "serverless-offline": {
      httpPort: 8000,
      lambdaPort: 3002,
      noPrependStageInUrl: true
    }
  }
};
