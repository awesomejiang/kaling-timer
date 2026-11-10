# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/mechanics/package.json packages/mechanics/package.json
COPY packages/timer-engine/package.json packages/timer-engine/package.json
COPY packages/voice/package.json packages/voice/package.json
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --strict-ssl=true
COPY apps/server apps/server
COPY packages packages
COPY config config
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@kaling/server"]
