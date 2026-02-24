# ─────────────────────────────────────────────────────────────────────
#  WeatherNow – Dockerfile (Node.js / Express)
# ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copy app source
COPY . .

# Music folder – volume-mounted at runtime
RUN mkdir -p /app/music

EXPOSE 3000

CMD ["node", "server.js"]
