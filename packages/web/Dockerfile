FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json ./
RUN pnpm install

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

EXPOSE 3000

CMD ["pnpm", "dev"]
