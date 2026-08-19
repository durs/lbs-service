import { Router } from 'express';

function parseRequiredInt(value, name) {
  const parsed = Number.parseInt(String(value).trim(), 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid or missing ${name}`);
  }

  return parsed;
}

function parseLbsFromQuery(query) {
  return {
    mcc: parseRequiredInt(query.mcc, 'mcc'),
    mnc: parseRequiredInt(query.mnc, 'mnc'),
    lac: parseRequiredInt(query.lac ?? query.tac, 'lac/tac'),
    cid: parseRequiredInt(query.cid ?? query.cellid ?? query.cell, 'cid/cellid'),
  };
}

function parseLbsFromBody(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be a JSON object');
  }

  return {
    mcc: parseRequiredInt(body.mcc, 'mcc'),
    mnc: parseRequiredInt(body.mnc, 'mnc'),
    lac: parseRequiredInt(body.lac ?? body.tac, 'lac/tac'),
    cid: parseRequiredInt(body.cid ?? body.cellid ?? body.cell, 'cid/cellid'),
  };
}

function parseCellsFromBody(body) {
  if (!body || !Array.isArray(body.cells)) {
    throw new Error('Request body must contain a "cells" array');
  }

  if (body.cells.length === 0) {
    throw new Error('At least one cell entry is required');
  }

  return body.cells.map((cell, index) => {
    try {
      return parseLbsFromBody(cell);
    } catch (error) {
      throw new Error(`cells[${index}]: ${error.message}`);
    }
  });
}

export function createLocateRouter(store) {
  const router = Router();

  router.get('/', (req, res) => {
    try {
      const lbs = parseLbsFromQuery(req.query);
      const tower = store.lookup(lbs);

      if (!tower) {
        return res.status(404).json({
          error: 'Cell tower not found',
          query: lbs,
        });
      }

      return res.json({
        query: lbs,
        location: {
          lat: tower.lat,
          lon: tower.lon,
          accuracyMeters: tower.range,
        },
        tower,
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/', (req, res) => {
    try {
      const lbs = parseLbsFromBody(req.body);
      const tower = store.lookup(lbs);

      if (!tower) {
        return res.status(404).json({
          error: 'Cell tower not found',
          query: lbs,
        });
      }

      return res.json({
        query: lbs,
        location: {
          lat: tower.lat,
          lon: tower.lon,
          accuracyMeters: tower.range,
        },
        tower,
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/multilaterate', (req, res) => {
    try {
      const cells = parseCellsFromBody(req.body);
      const result = store.locateMultiple(cells);

      if (!result) {
        return res.status(404).json({
          error: 'No matching cell towers found',
          query: { cells },
        });
      }

      return res.json({
        query: { cells },
        location: {
          lat: result.lat,
          lon: result.lon,
          accuracyMeters: result.accuracyMeters,
        },
        matchedCells: result.matchedCells,
        method: result.method,
        towers: result.towers,
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  return router;
}
