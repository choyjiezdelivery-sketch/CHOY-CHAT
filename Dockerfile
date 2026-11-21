# CHOY-CHAT — production image
#
# better-sqlite3 is a native module, so the build stage needs a compiler and
# python3. The runtime stage copies only the built node_modules, keeping the
# final image small and free of build tooling.

FROM node:20-bookworm-slim AS build

WORKDIR /app

# Toolchain for better-sqlite3's native addon.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# ---------------------------------------------------------------------------

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# tini reaps zombies and forwards SIGTERM, so the graceful shutdown in
# src/server.js actually runs on redeploy.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts

# Writable locations. Mount a volume at /app/data to keep the SQLite database
# across deploys; without one, every redeploy starts from an empty database.
RUN mkdir -p /app/data /app/uploads \
 && chown -R node:node /app/data /app/uploads

USER node

ENV PORT=3000 \
    DB_PATH=/app/data/choy-chat.db \
    UPLOAD_DIR=/app/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
