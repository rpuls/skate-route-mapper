FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:3001
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package.json package-lock.json tsconfig.base.json ./
COPY admin/package.json admin/package.json

RUN npm ci

COPY admin admin

RUN npm run admin:build

FROM nginx:1.27-alpine AS runner

COPY admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/admin/dist /usr/share/nginx/html

EXPOSE 80
