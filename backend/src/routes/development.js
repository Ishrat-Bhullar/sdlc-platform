const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Development
 *   description: Development and code generation
 */

// ── Proxy: build/start (FastAPI authoritative) ────────────────────────────────
// Frontend calls POST /build/start (no /api prefix in the URL passed to apiRequest)
// so this route is mounted at /api/development in index.js.
// We expose it at /api/build/start by creating the proxy in index.js instead.

module.exports = router;

