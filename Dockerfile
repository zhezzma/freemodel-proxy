FROM node:20-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=18002

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

RUN chown -R node:node /app
USER node

EXPOSE 18002

CMD ["node", "src/index.js"]
