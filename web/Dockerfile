# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /app
# Cache npm downloads across builds. Layer is invalidated only when
# package*.json changes; the underlying tarball cache survives.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .

# NEXT_PUBLIC_* vars are baked at build time. POLYMARKET_BUILDER_CODE is a
# public on-chain identifier, not a secret — safe to embed in the bundle.
ARG NEXT_PUBLIC_POLYMARKET_BUILDER_CODE=""
ARG NEXT_PUBLIC_POLYMARKET_CLOB_HOST=""
ARG POLYSCOPE_API_URL="http://api:8020"
ENV NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_POLYMARKET_BUILDER_CODE=${NEXT_PUBLIC_POLYMARKET_BUILDER_CODE}
ENV NEXT_PUBLIC_POLYMARKET_CLOB_HOST=${NEXT_PUBLIC_POLYMARKET_CLOB_HOST}
ENV POLYSCOPE_API_URL=${POLYSCOPE_API_URL}

# .next/cache is the Next build cache — incremental rebuilds reuse it.
# A BuildKit cache mount keeps it across builds without baking it into
# the image layers.
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV POLYSCOPE_API_URL="http://api:8020"
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3020
ENV PORT=3020
CMD ["node", "server.js"]
