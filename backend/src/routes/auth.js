const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validators } = require('../middleware/validate');

const router = express.Router();

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
  });
  const refreshToken = jwt.sign({ userId, type: 'refresh' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
  });
  return { accessToken, refreshToken };
};

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       201:
 *         description: User created
 *       409:
 *         description: Email already exists
 */
router.post('/register', validators.required(['email', 'password']), async (req, res, next) => {
  try {
    const { full_name, name, email, password } = req.body;
    const userName = full_name || name || email.split('@')[0];

    if (password.length < 8) {
      return res.status(400).json({ error: 'ValidationError', message: 'Password must be at least 8 characters' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Conflict', message: 'Email already registered' });
    }

const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'developer') RETURNING id, name, email, role, created_at`,
      [userName.trim(), email.toLowerCase().trim(), passwordHash]
    );

    const user = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, refreshToken, expiresAt]);

    // Initialize default AI settings
    await query('INSERT INTO user_ai_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);

    // Log session
    await query('INSERT INTO session_logs (user_id, ip_address, action) VALUES ($1, $2, $3)', [user.id, req.ip, 'register']);

    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful, returns tokens
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', validators.required(['email', 'password']), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, refreshToken, expiresAt]);
    await query('INSERT INTO session_logs (user_id, ip_address, device_info, action) VALUES ($1, $2, $3, $4)',
      [user.id, req.ip, req.headers['user-agent'], 'login']);

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout and invalidate refresh token
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out
 */
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1 AND user_id = $2', [refreshToken, req.user.id]);
    }
    await query('INSERT INTO session_logs (user_id, ip_address, action) VALUES ($1, $2, $3)', [req.user.id, req.ip, 'logout']);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     security: []
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Unauthorized', message: 'No refresh token' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const tokenResult = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND expires_at > NOW()',
      [refreshToken, decoded.userId]
    );

    if (!tokenResult.rows.length) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired refresh token' });
    }

    // Rotate refresh token
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [decoded.userId, newRefreshToken, expiresAt]);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
    }
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current user profile
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, email, role, avatar_url, timezone, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const aiSettings = await query('SELECT provider, model, openai_key_set, anthropic_key_set, gemini_key_set, ollama_url, ollama_model FROM user_ai_settings WHERE user_id = $1', [req.user.id]);

    res.json({ user: result.rows[0], aiSettings: aiSettings.rows[0] || null });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   put:
 *     summary: Update user profile
 *     tags: [Auth]
 */
router.put('/me', authenticate, async (req, res, next) => {
  try {
    const { name, timezone, avatar_url } = req.body;
    const result = await query(
      `UPDATE users SET name = COALESCE($1, name), timezone = COALESCE($2, timezone), avatar_url = COALESCE($3, avatar_url), updated_at = NOW()
       WHERE id = $4 RETURNING id, name, email, role, avatar_url, timezone`,
      [name, timezone, avatar_url, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Change user password
 *     tags: [Auth]
 */
router.post('/change-password', authenticate, validators.required(['currentPassword', 'newPassword']), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'BadRequest', message: 'Current password is incorrect' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'ValidationError', message: 'Password must be at least 8 characters' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);

    res.json({ message: 'Password changed. Please log in again.' });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/sessions:
 *   get:
 *     summary: Get session activity log
 *     tags: [Auth]
 */
router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM session_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;