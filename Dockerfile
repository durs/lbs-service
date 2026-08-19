FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV INDEX_PATH=/app/data/sample_cell_towers.idx

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data/sample_cell_towers.csv ./data/sample_cell_towers.csv

RUN node src/buildIndex.js data/sample_cell_towers.csv data/sample_cell_towers.idx

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
