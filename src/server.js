import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CellTowerStore } from './cellTowerStore.js';
import { createLocateRouter } from './routes/locate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

function resolveIndexPath() {
  const candidates = [
    process.argv[2],
    process.env.INDEX_PATH,
    path.join(projectRoot, 'data', 'sample_cell_towers.idx'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    `No index file found. Run "npm run build-index" first or set INDEX_PATH in .env`,
  );
}

const indexPath = resolveIndexPath();
const store = new CellTowerStore();
const app = express();

app.use(express.json());

app.use('/locate', createLocateRouter(store));

app.get('/stats', (_req, res) => {
  res.json(store.stats);
});

app.get('/health', (_req, res) => {
  res.json({
    status: store.isLoaded ? 'ok' : 'loading',
    ...store.stats,
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

function start() {
  console.log(`Opening index file ${indexPath}...`);
  const stats = store.load(indexPath);
  console.log(`Ready. ${stats.uniqueTowers} towers indexed.`);

  app.listen(port, () => {
    console.log(`OpenCellID LBS service listening on http://localhost:${port}`);
    console.log('Examples:');
    console.log(`  GET  http://localhost:${port}/locate?mcc=260&mnc=2&lac=45080&cid=21728`);
    console.log(`  POST http://localhost:${port}/locate`);
    console.log(`  POST http://localhost:${port}/locate/multilaterate`);
  });
}

try {
  start();
} catch (error) {
  console.error('Failed to start service:', error.message);
  process.exit(1);
}
