# ProductCraft 렌더 서비스 — Playwright 공식 이미지 (chromium 포함)
FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

ENV PORT=8791
EXPOSE 8791

# RENDER_TOKEN 은 docker run -e / compose env 로 주입 (이미지에 굽지 않음)
CMD ["node", "server.mjs"]
