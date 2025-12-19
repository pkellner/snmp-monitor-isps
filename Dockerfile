# Multi-stage build for Next.js app
# Works on both amd64 (MacBook) and arm64 (Raspberry Pi 5)

FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build arguments for environment variables needed at build time
ARG NEXT_PUBLIC_REFRESH_MS
ARG NEXT_PUBLIC_ISP_NAME_X1
ARG NEXT_PUBLIC_ISP_NAME_X2

ENV NEXT_PUBLIC_REFRESH_MS=$NEXT_PUBLIC_REFRESH_MS
ENV NEXT_PUBLIC_ISP_NAME_X1=$NEXT_PUBLIC_ISP_NAME_X1
ENV NEXT_PUBLIC_ISP_NAME_X2=$NEXT_PUBLIC_ISP_NAME_X2

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
