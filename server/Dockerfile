# Time Tracker sync server — tiny Node image, no npm dependencies.
FROM node:24-alpine
WORKDIR /app
COPY *.mjs ./
ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    PORT=8787 \
    DB_PATH=/data/sync.db
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
