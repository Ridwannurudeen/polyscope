FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# NEXT_PUBLIC_* vars are baked at build time. POLYMARKET_BUILDER_CODE is a
# public on-chain identifier, not a secret — safe to embed in the bundle.
ARG NEXT_PUBLIC_POLYMARKET_BUILDER_CODE=""
ARG NEXT_PUBLIC_POLYMARKET_CLOB_HOST=""
ENV NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_POLYMARKET_BUILDER_CODE=${NEXT_PUBLIC_POLYMARKET_BUILDER_CODE}
ENV NEXT_PUBLIC_POLYMARKET_CLOB_HOST=${NEXT_PUBLIC_POLYMARKET_CLOB_HOST}

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3020
ENV PORT=3020
CMD ["node", "server.js"]
