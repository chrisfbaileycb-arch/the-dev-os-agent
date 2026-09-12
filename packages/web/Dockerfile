FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime carries Chromium for the Browser Agent. Pin the Playwright image to the npm version.
FROM mcr.microsoft.com/playwright:v1.56.1-noble
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
USER pwuser
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "server/index.mjs"]
