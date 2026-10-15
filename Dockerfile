FROM node:24.14.1-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
