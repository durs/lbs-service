import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

const COLUMN_ALIASES = {
  mcc: ['mcc'],
  mnc: ['mnc', 'net'],
  lac: ['lac', 'area', 'tac'],
  cid: ['cid', 'cellid', 'cell'],
  lat: ['lat', 'latitude'],
  lon: ['lon', 'long', 'longitude'],
  radio: ['radio'],
  range: ['range'],
  samples: ['samples'],
  signal: ['averagesignal', 'averagesignalstrength', 'signal'],
};

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function resolveColumnMap(headers) {
  const normalized = headers.map(normalizeHeader);
  const map = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) {
      map[field] = index;
    }
  }

  return map;
}

function parseInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFloatValue(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRecord(record, columnMap) {
  const mcc = parseInteger(record[columnMap.mcc]);
  const mnc = parseInteger(record[columnMap.mnc]);
  const lac = parseInteger(record[columnMap.lac]);
  const cid = parseInteger(record[columnMap.cid]);
  const lat = parseFloatValue(record[columnMap.lat]);
  const lon = parseFloatValue(record[columnMap.lon]);

  if (
    mcc === null ||
    mnc === null ||
    lac === null ||
    cid === null ||
    lat === null ||
    lon === null ||
    lat === 0 ||
    lon === 0
  ) {
    return null;
  }

  return {
    mcc,
    mnc,
    lac,
    cid,
    lat,
    lon,
    radio: columnMap.radio !== undefined ? record[columnMap.radio] || null : null,
    range: columnMap.range !== undefined ? parseInteger(record[columnMap.range]) : null,
    samples: columnMap.samples !== undefined ? parseInteger(record[columnMap.samples]) : null,
    signal: columnMap.signal !== undefined ? parseInteger(record[columnMap.signal]) : null,
  };
}

export async function* streamTowersFromCsv(csvPath, stats = { rowCount: 0, skippedRows: 0, writtenRecords: 0 }) {
  let columnMap = null;

  const parser = createReadStream(csvPath).pipe(
    parse({
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );

  for await (const record of parser) {
    if (!columnMap) {
      const maybeHeader = resolveColumnMap(record);
      const hasIdentifiers =
        maybeHeader.mcc !== undefined &&
        maybeHeader.mnc !== undefined &&
        maybeHeader.lac !== undefined &&
        maybeHeader.cid !== undefined;

      if (hasIdentifiers) {
        columnMap = maybeHeader;
        continue;
      }

      columnMap = {
        radio: 0,
        mcc: 1,
        mnc: 2,
        lac: 3,
        cid: 4,
        lon: 7,
        lat: 8,
        range: 9,
        samples: 10,
        signal: 13,
      };
    }

    stats.rowCount += 1;

    if (stats.rowCount % 1_000_000 === 0) {
      console.log(`  parsed ${stats.rowCount.toLocaleString()} CSV rows...`);
    }

    const tower = parseRecord(record, columnMap);
    if (!tower) {
      stats.skippedRows += 1;
      continue;
    }

    stats.writtenRecords += 1;
    yield tower;
  }
}
