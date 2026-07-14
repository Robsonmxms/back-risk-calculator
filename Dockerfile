# syntax=docker/dockerfile:1.7

FROM node:26.5.0-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json yarn.lock* .yarnrc.yml ./
RUN yarn install

FROM deps AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY . .
EXPOSE 8000
CMD ["yarn", "dev"]

FROM deps AS build
WORKDIR /app
COPY . .
RUN yarn build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8000
COPY package.json yarn.lock* .yarnrc.yml ./
RUN yarn install --production
COPY --from=build /app/dist ./dist
EXPOSE 8000
CMD ["yarn", "start"]
