import { Router } from 'express';

function parseRequiredInt(value, name) {
  const parsed = Number.parseInt(String(value).trim(), 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid or missing ${name}`);
  }

  return parsed;
}

function parseLbsFromString(str) {
  const parts = str.split(':');
  if (parts.length < 3) {
    throw new Error(`Invalid cell info`);
  }
  let mcc, mnc, ofs;
  if (parts.length < 4) {
    mcc = parts[0].substring(0, 3);
    mnc = parts[0].substring(3);
    ofs = 0;
  } else {
    mcc = parts[0];
    mnc = parts[1];
    ofs = 1;
  }
  return {
    mcc: parseRequiredInt(mcc, 'mcc'),
    mnc: parseRequiredInt(mnc, 'mnc'),
    lac: parseRequiredInt(parts[ofs + 1], 'lac/tac'),
    cid: parseRequiredInt(parts[ofs + 2], 'cid/cellid'),
  };
}

function parseLbsFromObject(body) {
  return {
    mcc: parseRequiredInt(body.mcc, 'mcc'),
    mnc: parseRequiredInt(body.mnc, 'mnc'),
    lac: parseRequiredInt(body.lac ?? body.tac, 'lac/tac'),
    cid: parseRequiredInt(body.cid ?? body.cellid ?? body.cell, 'cid/cellid'),
  };
}

function parseLbsFromQuery(query) {
  if (typeof query.cell === 'string') {
      return parseLbsFromString(query.cell);
  }
  return parseLbsFromObject(query);
}

function parseCellsFromBody(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be a JSON object');
  }

  if (!Array.isArray(body.cells)) {
    if (typeof body.cell === 'string') {
      return parseLbsFromString(body.cell);
    }
    return [parseLbsFromObject(body)];
  }

  if (body.cells.length === 0) {
    throw new Error('At least one cell entry is required');
  }

  return body.cells.map((cell, index) => {
    try {
      if (typeof cell === 'string') {
        return parseLbsFromString(cell);
      }
      if (typeof cell !== 'object') {
        throw new Error('Cell must be a JSON object or string');
      }
      return parseLbsFromObject(cell);
    } catch (error) {
      throw new Error(`cells[${index}]: ${error.message}`);
    }
  });
}

export function createLocateRouter(store) {
  const router = Router();

  router.get('/', (req, res) => {
    try {
      const query = req.query;
      const lbs = parseLbsFromQuery(query);
      const tower = store.lookup(lbs);

      if (!tower) {
        return res.status(200).json({
          error: 'Cell tower not found',
        });
      }

      const answer = {
        position: {
          lat: tower.lat,
          lon: tower.lon,
          accuracy: tower.range,
        },
      };
      if (+query.detail || query.detail === '') {
        answer.method = 'single-cell';
        answer.towers = [tower];
      }

      return res.json(answer);
    } catch (error) {
      return res.status(200).json({ error: error.message });
    }
  });

  router.post('/', (req, res) => {
    try {
      const body = req.body;
      const cells = parseCellsFromBody(body);
      const result = store.locateMultiple(cells);

      if (!result) {
        return res.status(404).json({
          error: 'No matching cell towers found',
        });
      }

      const answer = {
        position: {
          lat: result.lat,
          lon: result.lon,
          accuracy: result.accuracy,
        },
      }
      if (+body.detail) {
        answer.method = result.method;
        answer.towers = result.towers;
      }

      return res.json(answer);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  return router;
}
