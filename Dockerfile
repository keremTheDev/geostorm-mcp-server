FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# The MCP server uses stdio transport. Port 6274 is documented for tooling
# compatibility only; this container does not serve HTTP by default.
EXPOSE 6274

CMD ["node", "dist/index.js"]
