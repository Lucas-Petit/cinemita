FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js seed.js ./
COPY public ./public

ENV PORT=3000
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "server.js"]
