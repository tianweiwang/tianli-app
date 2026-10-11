FROM node:24.21.0-alpine AS build
WORKDIR /source/deployment/coolify
COPY deployment/coolify/package.json deployment/coolify/package-lock.json ./
RUN npm ci --ignore-scripts --omit=optional --no-audit --no-fund
COPY deployment/coolify/build-site.cjs ./
COPY design/integrated-v5 /source/design/integrated-v5
COPY design/reference-demos/franchise-demo/products /source/design/reference-demos/franchise-demo/products
ARG SOURCE_COMMIT=d7c3a99793d5b8334451a3173a55ba2369ca8a55
RUN SOURCE_COMMIT=$SOURCE_COMMIT node build-site.cjs /source /site

FROM node:24.21.0-alpine
ENV NODE_ENV=production PORT=8080 SITE_ROOT=/app/site
WORKDIR /app
COPY --from=build --chown=node:node /site ./site
COPY --chown=node:node deployment/coolify/server.cjs ./server.cjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
