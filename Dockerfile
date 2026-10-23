FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    TZ=Europe/Paris \
    TADO_TOKEN_FILE=/data/tado-token.json
WORKDIR /app
RUN apk add --no-cache tzdata && mkdir -p /data && chown node:node /data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
VOLUME ["/data"]
ENTRYPOINT ["node", "dist/index.js"]
