import fs from 'node:fs';
import path from 'node:path';
import { compareRecordBuffers } from './towerRecord.js';

const DEFAULT_CHUNK_RECORDS = 250_000;

function sortChunkRecords(chunkBuffer, recordCount, recordSize) {
  const indices = new Uint32Array(recordCount);
  for (let i = 0; i < recordCount; i += 1) {
    indices[i] = i;
  }

  indices.sort((a, b) =>
    compareRecordBuffers(
      chunkBuffer,
      a * recordSize,
      chunkBuffer,
      b * recordSize,
    ),
  );

  return indices;
}

function writeSortedRun(chunkBuffer, indices, recordSize, runPath) {
  const fd = fs.openSync(runPath, 'w');
  const recordBuffer = Buffer.alloc(recordSize);

  try {
    for (let i = 0; i < indices.length; i += 1) {
      const offset = indices[i] * recordSize;
      chunkBuffer.copy(recordBuffer, 0, offset, offset + recordSize);
      fs.writeSync(fd, recordBuffer);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function createRuns(inputPath, tempDir, recordSize, chunkRecords, onProgress) {
  const inputFd = fs.openSync(inputPath, 'r');
  const fileSize = fs.statSync(inputPath).size;
  const runPaths = [];
  const chunkByteSize = chunkRecords * recordSize;
  const chunkBuffer = Buffer.alloc(chunkByteSize);
  let fileOffset = 0;
  let runIndex = 0;

  try {
    while (fileOffset < fileSize) {
      const bytesToRead = Math.min(chunkByteSize, fileSize - fileOffset);
      const bytesRead = fs.readSync(inputFd, chunkBuffer, 0, bytesToRead, fileOffset);
      const recordCount = Math.floor(bytesRead / recordSize);

      if (recordCount === 0) {
        break;
      }

      const indices = sortChunkRecords(chunkBuffer, recordCount, recordSize);
      const runPath = path.join(tempDir, `run-${String(runIndex).padStart(5, '0')}.bin`);
      writeSortedRun(chunkBuffer, indices, recordSize, runPath);
      runPaths.push(runPath);

      runIndex += 1;
      fileOffset += recordCount * recordSize;

      if (onProgress) {
        onProgress(fileOffset, fileSize, runPaths.length);
      }
    }
  } finally {
    fs.closeSync(inputFd);
  }

  return runPaths;
}

function mergeRuns(runPaths, outputPath, recordSize, onProgress) {
  const runs = runPaths.map((runPath) => ({
    fd: fs.openSync(runPath, 'r'),
    buffer: Buffer.alloc(recordSize),
    exhausted: false,
  }));

  const outputFd = fs.openSync(outputPath, 'w');
  let mergedRecords = 0;

  try {
    for (const run of runs) {
      const bytesRead = fs.readSync(run.fd, run.buffer, 0, recordSize, null);
      run.exhausted = bytesRead < recordSize;
    }

    while (true) {
      let minRun = null;

      for (const run of runs) {
        if (run.exhausted) {
          continue;
        }

        if (
          !minRun ||
          compareRecordBuffers(run.buffer, 0, minRun.buffer, 0) < 0
        ) {
          minRun = run;
        }
      }

      if (!minRun) {
        break;
      }

      fs.writeSync(outputFd, minRun.buffer);
      mergedRecords += 1;

      if (onProgress && mergedRecords % 1_000_000 === 0) {
        onProgress(mergedRecords);
      }

      const bytesRead = fs.readSync(minRun.fd, minRun.buffer, 0, recordSize, null);
      minRun.exhausted = bytesRead < recordSize;
    }
  } finally {
    fs.closeSync(outputFd);
    for (const run of runs) {
      fs.closeSync(run.fd);
    }
  }

  return mergedRecords;
}

export function externalSort(inputPath, outputPath, recordSize, options = {}) {
  const chunkRecords = options.chunkRecords ?? DEFAULT_CHUNK_RECORDS;
  const tempDir =
    options.tempDir ??
    path.join(path.dirname(outputPath), `.sort-${path.basename(outputPath)}.tmp`);

  fs.mkdirSync(tempDir, { recursive: true });

  console.log(`  creating sorted runs (chunk: ${chunkRecords.toLocaleString()} records)...`);

  const runPaths = createRuns(inputPath, tempDir, recordSize, chunkRecords, (offset, total, runCount) => {
    const pct = ((offset / total) * 100).toFixed(1);
    console.log(`  sorted ${pct}% (${runCount} runs)`);
  });

  if (runPaths.length === 0) {
    fs.writeFileSync(outputPath, Buffer.alloc(0));
    fs.rmSync(tempDir, { recursive: true, force: true });
    return 0;
  }

  console.log(`  merging ${runPaths.length} runs...`);

  const mergedRecords = mergeRuns(runPaths, outputPath, recordSize, (count) => {
    console.log(`  merged ${count.toLocaleString()} records...`);
  });

  for (const runPath of runPaths) {
    fs.unlinkSync(runPath);
  }
  fs.rmSync(tempDir, { recursive: true, force: true });

  return mergedRecords;
}
