import fs from 'node:fs';
import path from 'node:path';
import {
  HEADER_SIZE,
  INDEX_MAGIC,
  INDEX_VERSION,
  RECORD_SIZE,
  compareKeys,
  decodeRecord,
} from './lib/towerRecord.js';

export class CellTowerStore {
  #fd = null;
  #recordCount = 0;
  #indexPath = '';
  #loaded = false;
  #recordBuffer = Buffer.alloc(RECORD_SIZE);

  get isLoaded() {
    return this.#loaded;
  }

  get stats() {
    return {
      indexPath: this.#indexPath,
      uniqueTowers: this.#recordCount,
      loaded: this.#loaded,
    };
  }

  load(indexPath) {
    const resolvedPath = path.resolve(indexPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Index file not found: ${resolvedPath}`);
    }

    this.close();

    const fd = fs.openSync(resolvedPath, 'r');
    const header = Buffer.alloc(HEADER_SIZE);
    fs.readSync(fd, header, 0, HEADER_SIZE, 0);

    const magic = header.readUInt32LE(0);
    const version = header.readUInt32LE(4);
    const recordCount = header.readUInt32LE(8);

    if (magic !== INDEX_MAGIC) {
      fs.closeSync(fd);
      throw new Error('Invalid index file: bad magic header');
    }

    if (version !== INDEX_VERSION) {
      fs.closeSync(fd);
      throw new Error(`Unsupported index version: ${version}`);
    }

    this.#fd = fd;
    this.#recordCount = recordCount;
    this.#indexPath = resolvedPath;
    this.#loaded = true;

    return this.stats;
  }

  close() {
    if (this.#fd !== null) {
      fs.closeSync(this.#fd);
      this.#fd = null;
    }

    this.#loaded = false;
    this.#recordCount = 0;
  }

  #readRecordAt(index) {
    const offset = HEADER_SIZE + index * RECORD_SIZE;
    fs.readSync(this.#fd, this.#recordBuffer, 0, RECORD_SIZE, offset);
    return decodeRecord(this.#recordBuffer);
  }

  lookup({ mcc, mnc, lac, cid }) {
    if (!this.#loaded) {
      return null;
    }

    let low = 0;
    let high = this.#recordCount - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const tower = this.#readRecordAt(mid);
      const cmp = compareKeys(mcc, mnc, lac, cid, tower, this.#recordBuffer);

      if (cmp === 0) {
        return tower;
      }

      if (cmp < 0) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return null;
  }

  locateMultiple(cells) {
    const matches = [];

    for (const cell of cells) {
      const tower = this.lookup(cell);
      if (tower) {
        matches.push(tower);
      }
    }

    if (matches.length === 0) {
      return null;
    }

    if (matches.length === 1) {
      return {
        lat: matches[0].lat,
        lon: matches[0].lon,
        accuracy: matches[0].range,
        method: 'single-cell',
        towers: matches,
      };
    }

    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLon = 0;
    let minRange = null;

    for (const tower of matches) {
      const weight = Math.max(tower.samples ?? 1, 1);
      totalWeight += weight;
      weightedLat += tower.lat * weight;
      weightedLon += tower.lon * weight;

      if (tower.range !== null) {
        minRange = minRange === null ? tower.range : Math.min(minRange, tower.range);
      }
    }

    return {
      lat: weightedLat / totalWeight,
      lon: weightedLon / totalWeight,
      accuracy: minRange,
      method: 'weighted-average',
      towers: matches,
    };
  }
}
