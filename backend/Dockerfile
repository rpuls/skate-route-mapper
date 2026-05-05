FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY shared/package.json shared/package.json

RUN npm ci

COPY backend backend
COPY shared shared
COPY db db

RUN npm run prisma:generate --workspace @skate-route-mapper/api
RUN npm run api:build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY shared/package.json shared/package.json
COPY shared/src shared/src
COPY db db

RUN npm ci --omit=dev --workspace @skate-route-mapper/api

COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/generated backend/generated

EXPOSE 3001

CMD ["npm", "run", "api:start"]
