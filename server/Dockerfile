# Standalone presence relay for House of Entropy multiplayer.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY relay.mjs ./
ENV PORT=8787
EXPOSE 8787
CMD ["node", "relay.mjs"]
