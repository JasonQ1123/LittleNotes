FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS base
# Bootstrap HTTPS using the CA roots bundled with Node, before ca-certificates is installed.
RUN node -e "require('node:fs').writeFileSync('/tmp/littlenotes-ca.pem', require('node:tls').rootCertificates.join('\n') + '\n')" \
    && sed -i 's|http://deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::https::CaInfo=/tmp/littlenotes-ca.pem -o Acquire::https::Timeout=30 -o Acquire::Retries=3 update \
    && apt-get -o Acquire::https::CaInfo=/tmp/littlenotes-ca.pem -o Acquire::https::Timeout=30 -o Acquire::Retries=3 install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* /tmp/littlenotes-ca.pem

FROM base AS build
RUN npm install -g pnpm@11.22.0
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=768
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --network-concurrency=4 --child-concurrency=1
COPY . .
RUN pnpm --filter @paper/api db:postgres:generate && pnpm build

FROM base AS api
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api ./apps/api
USER node
WORKDIR /app/apps/api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NODE_OPTIONS=--max-old-space-size=384
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM public.ecr.aws/docker/library/caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
