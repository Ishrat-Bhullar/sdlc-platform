require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const swaggerUi = require('swagger-ui-express');
const rateLimit = require('express-rate-limit');

const swaggerSpec = require('./config/swagger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const projectsRoutes = require('./routes/projects');
const dashboardRoutes = require('./routes/dashboard');
const requirementsRoutes = require('./routes/requirements');
const generatedArtifactsRoutes = require('./routes/generatedArtifacts');
const architectureRoutes = require('./routes/architecture');
const databaseRoutes = require('./routes/database');
const developmentRoutes = require('./routes/development');
const approvalsRoutes = require('./routes/approvals');
const documentationRoutes = require('./routes/documentation');
const settingsRoutes = require('./routes/settings');
const { authenticate } = require('./middleware/auth');


const { initWebSocket } = require('./websocket/progressSocket');

const app = express();
const server = http.createServer(app);

// ── WebSocket ────────────────────────────────────────────────────────────────
initWebSocket(server);

// ── Security & parsing ───────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(
  '/api/auth',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false })
);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Swagger ───────────────────────────────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/requirements', requirementsRoutes);
app.use('/api/architecture', architectureRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/development', developmentRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/workflow', approvalsRoutes);
app.use('/api/documentation', documentationRoutes);
app.use('/api/settings', settingsRoutes);

// ── Generated Artifacts (unified endpoint) ────────────────────────────────────
// Prefer proxying to FastAPI so artifact types produced by the Python pipeline are visible in the dashboard.
app.use('/api/generated_artifacts', generatedArtifactsRoutes);

// ── Proxy FastAPI build/start so the frontend launch flow works ────────────
// Frontend calls POST /build/start (no /api prefix) using apiRequest(),
// which currently targets `${VITE_API_BASE_URL}`. With default base URL
// of http://localhost:8000/api, this becomes POST /api/build/start.
// FastAPI route is POST /build/start, so we add this adapter.
app.post('/api/build/start', async (req, res, next) => {
  try {
    const axios = require('axios');
const PYTHON_AGENT_BASE_URL = process.env.PYTHON_AGENT_BASE_URL || 'http://localhost:8000';
    const url = `${PYTHON_AGENT_BASE_URL}/build/start`;

    const response = await axios.post(url, req.body, {
      headers: {
        'Content-Type': 'application/json',
      },

      // Forward cookies are not available from Node axios in the browser context.
      // FastAPI demo mode/bypass handles unauthenticated requests.
    });

    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'BuildStartProxyError',
      message: err.response?.data?.detail || err.message || 'Failed to proxy build/start',
    });
  }
});

// ── 404 / error ───────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);


// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 EY SDLC Studio backend running on port ${PORT}`);
  console.log(`📖 Swagger docs: http://localhost:${PORT}/api/docs`);
  console.log(`🔌 WebSocket:    ws://localhost:${PORT}/ws`);
});

module.exports = { app, server };