export const RECORD_SIZE = 34;
export const INDEX_MAGIC = 0x4f434c44; // "OCLD"
export const INDEX_VERSION = 2;
export const HEADER_SIZE = 16;
export const RANGE_NULL = 0xffffffff;

export function towerKey(mcc, mnc, lac, cid) {
  return `${mcc}:${mnc}:${lac}:${cid}`;
}

export function compareRecordBuffers(bufferA, offsetA, bufferB, offsetB) {
  const mccA = bufferA.readUInt16LE(offsetA);
  const mccB = bufferB.readUInt16LE(offsetB);
  if (mccA !== mccB) return mccA - mccB;

  const mncA = bufferA.readUInt16LE(offsetA + 2);
  const mncB = bufferB.readUInt16LE(offsetB + 2);
  if (mncA !== mncB) return mncA - mncB;

  const lacA = bufferA.readUInt32LE(offsetA + 4);
  const lacB = bufferB.readUInt32LE(offsetB + 4);
  if (lacA !== lacB) return lacA - lacB;

  const cidA = bufferA.readUInt32LE(offsetA + 8);
  const cidB = bufferB.readUInt32LE(offsetB + 8);
  return cidA - cidB;
}

export function compareKeys(mcc, mnc, lac, cid, _record, buffer, offset = 0) {
  const recordMcc = buffer.readUInt16LE(offset);
  const recordMnc = buffer.readUInt16LE(offset + 2);
  const recordLac = buffer.readUInt32LE(offset + 4);
  const recordCid = buffer.readUInt32LE(offset + 8);

  if (mcc !== recordMcc) return mcc - recordMcc;
  if (mnc !== recordMnc) return mnc - recordMnc;
  if (lac !== recordLac) return lac - recordLac;
  return cid - recordCid;
}

export function recordKeysEqual(bufferA, offsetA, bufferB, offsetB) {
  return compareRecordBuffers(bufferA, offsetA, bufferB, offsetB) === 0;
}

export function encodeRecord(tower, buffer, offset = 0) {
  if (tower.mcc < 0 || tower.mcc > 0xffff) {
    throw new RangeError(`mcc out of range: ${tower.mcc}`);
  }
  if (tower.mnc < 0 || tower.mnc > 0xffff) {
    throw new RangeError(`mnc out of range: ${tower.mnc}`);
  }

  buffer.writeUInt16LE(tower.mcc, offset);
  buffer.writeUInt16LE(tower.mnc, offset + 2);
  buffer.writeUInt32LE(tower.lac, offset + 4);
  buffer.writeUInt32LE(tower.cid, offset + 8);
  buffer.writeDoubleLE(tower.lat, offset + 12);
  buffer.writeDoubleLE(tower.lon, offset + 20);

  const range = tower.range ?? RANGE_NULL;
  buffer.writeUInt32LE(range >= 0 && range <= 0xfffffffe ? range : RANGE_NULL, offset + 28);
  buffer.writeUInt16LE(Math.min(Math.max(tower.samples ?? 0, 0), 0xffff), offset + 32);
}

export function decodeRecord(buffer, offset = 0) {
  const range = buffer.readUInt32LE(offset + 28);
  const samples = buffer.readUInt16LE(offset + 32);

  return {
    mcc: buffer.readUInt16LE(offset),
    mnc: buffer.readUInt16LE(offset + 2),
    lac: buffer.readUInt32LE(offset + 4),
    cid: buffer.readUInt32LE(offset + 8),
    lat: buffer.readDoubleLE(offset + 12),
    lon: buffer.readDoubleLE(offset + 20),
    radio: null,
    range: range === RANGE_NULL ? null : range,
    samples: samples === 0 ? null : samples,
    signal: null,
  };
}

export function pickBestTower(existing, candidate) {
  if (!existing) {
    return candidate;
  }

  const existingSamples = existing.samples ?? 0;
  const candidateSamples = candidate.samples ?? 0;

  if (candidateSamples !== existingSamples) {
    return candidateSamples > existingSamples ? candidate : existing;
  }

  const existingRange = existing.range ?? Number.MAX_SAFE_INTEGER;
  const candidateRange = candidate.range ?? Number.MAX_SAFE_INTEGER;

  return candidateRange < existingRange ? candidate : existing;
}

function readRecordSamples(buffer, offset) {
  const samples = buffer.readUInt16LE(offset + 32);
  return samples === 0 ? 0 : samples;
}

function readRecordRange(buffer, offset) {
  const range = buffer.readUInt32LE(offset + 28);
  return range === RANGE_NULL ? Number.MAX_SAFE_INTEGER : range;
}

export function pickBestRecordInPlace(bestBuffer, bestOffset, candidateBuffer, candidateOffset) {
  const bestSamples = readRecordSamples(bestBuffer, bestOffset);
  const candidateSamples = readRecordSamples(candidateBuffer, candidateOffset);

  if (candidateSamples !== bestSamples) {
    if (candidateSamples > bestSamples) {
      candidateBuffer.copy(bestBuffer, bestOffset, candidateOffset, candidateOffset + RECORD_SIZE);
    }
    return;
  }

  const bestRange = readRecordRange(bestBuffer, bestOffset);
  const candidateRange = readRecordRange(candidateBuffer, candidateOffset);

  if (candidateRange < bestRange) {
    candidateBuffer.copy(bestBuffer, bestOffset, candidateOffset, candidateOffset + RECORD_SIZE);
  }
}

export function sortTowers(towers) {
  return towers.sort((a, b) => {
    if (a.mcc !== b.mcc) return a.mcc - b.mcc;
    if (a.mnc !== b.mnc) return a.mnc - b.mnc;
    if (a.lac !== b.lac) return a.lac - b.lac;
    return a.cid - b.cid;
  });
}
