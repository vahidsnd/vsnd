# Neon Brawl game server + web client in one image.
#   docker build -t neonbrawl .
#   docker run -p 8787:8787 -v nbdata:/data -e ADMIN_KEY=... neonbrawl
# PostgreSQL: set DATABASE_URL (see docker-compose.yml and docs/DEPLOY.md).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY client/plugins client/plugins
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY server server
COPY client client
# web client → client/dist (served by the game server on the same port)
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node directly (not npm) so SIGTERM reaches the server and the final flush runs
CMD ["node", "--import", "tsx", "server/src/index.ts"]
