import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamTowersFromCsv } from './lib/csvTowerParser.js';
import { externalSort } from './lib/externalSort.js';
import {
  HEADER_SIZE,
  INDEX_MAGIC,
  INDEX_VERSION,
  RECORD_SIZE,
  encodeRecord,
  pickBestRecordInPlace,
  recordKeysEqual,
} from './lib/towerRecord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_CHUNK_RECORDS = 250_000;

function resolveCsvPath() {
  const candidates = [
    process.argv[2],
    process.env.CSV_PATH,
    path.join(projectRoot, 'data', 'sample_cell_towers.csv'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error('CSV file not found. Pass path as argument or set CSV_PATH.');
}

function resolveIndexPath(csvPath) {
  const explicit = process.argv[3] ?? process.env.INDEX_PATH;
  if (explicit) {
    return path.resolve(explicit);
  }

  const baseName = path.basename(csvPath, path.extname(csvPath));
  return path.join(path.dirname(csvPath), `${baseName}.idx`);
}

function resolveChunkRecords() {
  const fromEnv = Number.parseInt(process.env.BUILD_CHUNK_RECORDS ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }

  return DEFAULT_CHUNK_RECORDS;
}

function cleanupTempFiles(...paths) {
  for (const tempPath of paths) {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

async function streamCsvToTemp(csvPath, tempPath) {
  const stats = { rowCount: 0, skippedRows: 0, writtenRecords: 0 };
  const fd = fs.openSync(tempPath, 'w');
  const recordBuffer = Buffer.alloc(RECORD_SIZE);

  try {
    for await (const tower of streamTowersFromCsv(csvPath, stats)) {
      encodeRecord(tower, recordBuffer);
      fs.writeSync(fd, recordBuffer);

      if (stats.writtenRecords % 1_000_000 === 0) {
        console.log(`  written ${stats.writtenRecords.toLocaleString()} records...`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return stats;
}

function dedupeSortedToIndex(sortedPath, indexPath) {
  const inputFd = fs.openSync(sortedPath, 'r');
  const outputFd = fs.openSync(indexPath, 'w');

  fs.writeSync(outputFd, Buffer.alloc(HEADER_SIZE));

  const incoming = Buffer.alloc(RECORD_SIZE);
  const best = Buffer.alloc(RECORD_SIZE);
  let hasBest = false;
  let uniqueRecords = 0;

  try {
    while (true) {
      const bytesRead = fs.readSync(inputFd, incoming, 0, RECORD_SIZE, null);
      if (bytesRead < RECORD_SIZE) {
        break;
      }

      if (!hasBest) {
        incoming.copy(best);
        hasBest = true;
        continue;
      }

      if (recordKeysEqual(best, 0, incoming, 0)) {
        pickBestRecordInPlace(best, 0, incoming, 0);
      } else {
        fs.writeSync(outputFd, best);
        uniqueRecords += 1;
        incoming.copy(best);
      }
    }

    if (hasBest) {
      fs.writeSync(outputFd, best);
      uniqueRecords += 1;
    }
  } finally {
    fs.closeSync(inputFd);
    fs.closeSync(outputFd);
  }

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(INDEX_MAGIC, 0);
  header.writeUInt32LE(INDEX_VERSION, 4);
  header.writeUInt32LE(uniqueRecords, 8);
  header.writeUInt32LE(0, 12);

  const indexFd = fs.openSync(indexPath, 'r+');
  try {
    fs.writeSync(indexFd, header, 0, HEADER_SIZE, 0);
  } finally {
    fs.closeSync(indexFd);
  }

  return uniqueRecords;
}

async function main() {
  const csvPath = resolveCsvPath();
  const indexPath = resolveIndexPath(csvPath);
  const chunkRecords = resolveChunkRecords();
  const tempUnsorted = `${indexPath}.unsorted.tmp`;
  const tempSorted = `${indexPath}.sorted.tmp`;

  console.log(`Reading CSV (stream): ${csvPath}`);
  const startedAt = Date.now();

  try {
    console.log('Phase 1/3: streaming CSV rows to temp file...');
    const streamStats = await streamCsvToTemp(csvPath, tempUnsorted);
    console.log(
      `  ${streamStats.rowCount.toLocaleString()} rows, ${streamStats.skippedRows.toLocaleString()} skipped, ${streamStats.writtenRecords.toLocaleString()} records written`,
    );

    if (streamStats.writtenRecords === 0) {
      throw new Error('No valid cell tower records found in CSV');
    }

    console.log('Phase 2/3: external sort...');
    externalSort(tempUnsorted, tempSorted, RECORD_SIZE, { chunkRecords });

    console.log('Phase 3/3: deduplicating and writing index...');
    const uniqueRecords = dedupeSortedToIndex(tempSorted, indexPath);

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    const indexSizeMb = (fs.statSync(indexPath).size / (1024 * 1024)).toFixed(2);

    console.log(`Done. ${uniqueRecords.toLocaleString()} unique towers, ${indexSizeMb} MB, ${elapsedSec}s`);
    console.log(`Index: ${indexPath}`);
  } finally {
    cleanupTempFiles(tempUnsorted, tempSorted);
  }
}

main().catch((error) => {
  console.error('Index build failed:', error.message);
  process.exit(1);
});
