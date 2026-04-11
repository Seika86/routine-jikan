FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json .npmrc ./
RUN pnpm install

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src

RUN mkdir -p data drizzle

EXPOSE 3001

CMD ["pnpm", "dev"]
