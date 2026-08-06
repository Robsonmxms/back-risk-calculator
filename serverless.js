module.exports = {
  service: "back-risk-calculator",
  frameworkVersion: "3",
  plugins: ["serverless-offline"],
  provider: {
    name: "aws",
    // Serverless v3 local packaging supports managed Node 20 here. Production deployments that
    // must honor the Node 26 engine should use the existing Dockerfile as a Lambda container image.
    runtime: "nodejs20.x",
    stage: "${opt:stage, 'dev'}",
    region: "us-east-1",
    memorySize: 1024,
    timeout: 28,
    logRetentionInDays: 14,
    environment: {
      NODE_ENV: "${self:provider.stage}",
      PORT: "${env:PORT, '8000'}",
      ACCESS_TOKEN_SECRET:
        "${env:ACCESS_TOKEN_SECRET, 'dev-only-change-me-risk-calculator-access-token-secret'}",
      ACCESS_TOKEN_TTL_SECONDS: "${env:ACCESS_TOKEN_TTL_SECONDS, '900'}",
      REFRESH_TOKEN_TTL_DAYS: "${env:REFRESH_TOKEN_TTL_DAYS, '30'}",
      CORS_ALLOWED_ORIGINS: "${env:CORS_ALLOWED_ORIGINS, ''}",
      DATABASE_URL:
        "${env:DATABASE_URL, 'postgres://risk_calculator:risk_calculator@127.0.0.1:5432/risk_calculator_dev'}"
    }
  },
  package: {
    patterns: [
      "!src/**",
      "!tests/**",
      "!coverage/**",
      "!dist/tests/**",
      "dist/src/**",
      "package.json",
      "yarn.lock",
      ".yarnrc.yml"
    ]
  },
  functions: {
    api: {
      handler: "dist/src/04-infra/serverless.handler",
      reservedConcurrency: 10,
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
