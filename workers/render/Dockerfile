# Shemoqmedi render worker: Node 22 + ffmpeg (libx264, AAC), no npm deps.
FROM node:22-alpine

RUN apk add --no-cache ffmpeg \
 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264

WORKDIR /app
COPY package.json server.mjs ffmpeg.mjs ./

ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
