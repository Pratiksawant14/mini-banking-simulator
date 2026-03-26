const express = require('express');
const router = express.Router();
const axios = require('axios');

const PYTHON_ENGINE = 'http://localhost:6000';

// ─── Generic proxy helpers ────────────────────────────────────────────────────

async function forwardPost(enginePath, req, res) {
  try {
    const response = await axios.post(`${PYTHON_ENGINE}${enginePath}`, req.body);
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data   = err.response?.data  || { error: err.message };
    res.status(status).json(data);
  }
}

async function forwardGet(enginePath, req, res) {
  try {
    const response = await axios.get(`${PYTHON_ENGINE}${enginePath}`);
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data   = err.response?.data  || { error: err.message };
    res.status(status).json(data);
  }
}

// ─── Transaction forwarding routes ───────────────────────────────────────────

router.post('/transaction/begin',    (req, res) => forwardPost('/transaction/begin',    req, res));
router.post('/transaction/read',     (req, res) => forwardPost('/transaction/read',     req, res));
router.post('/transaction/write',    (req, res) => forwardPost('/transaction/write',    req, res));
router.post('/transaction/commit',   (req, res) => forwardPost('/transaction/commit',   req, res));
router.post('/transaction/rollback', (req, res) => forwardPost('/transaction/rollback', req, res));

// ─── Lock forwarding routes ───────────────────────────────────────────────────

router.post('/lock/acquire',      (req, res) => forwardPost('/lock/acquire',      req, res));
router.post('/lock/release-all',  (req, res) => forwardPost('/lock/release-all',  req, res));
router.get ('/lock/table',        (req, res) => forwardGet ('/lock/table',        req, res));

// ─── Deadlock forwarding routes ───────────────────────────────────────────────

router.get('/deadlock/check', (req, res) => forwardGet('/deadlock/check', req, res));
router.get('/deadlock/graph', (req, res) => forwardGet('/deadlock/graph', req, res));
router.get('/schedules',      (req, res) => forwardGet('/schedules',      req, res));

// ─── System Reset ─────────────────────────────────────────────────────────────

router.post('/reset', (req, res) => forwardPost('/reset', req, res));

module.exports = router;

