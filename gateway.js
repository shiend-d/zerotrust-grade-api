import express from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { config, tokenLifetime } from './config.js';
import { db, passwordMatches, writeAudit } from './db.js';
import { evaluatePolicy } from './policy.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

function authAudit(req, result, reason, subject = 'anonymous', role = 'none') {
  writeAudit({ subject, role, endpoint: `${req.method} ${req.path}`, deviceId: req.get('X-Device-ID') ?? 'none', result, reason });
}

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? ''));
  if (!user || typeof password !== 'string' || !passwordMatches(password, user.password)) {
    authAudit(req, 'DENY', 'Kredensial tidak valid', username || 'anonymous');
    return res.status(401).json({ status: 'DENY', reason: 'Kredensial tidak valid' });
  }
  const deviceId = req.get('X-Device-ID');
  if (!deviceId || deviceId !== user.device_id) {
    authAudit(req, 'DENY', 'Device ID tidak terdaftar untuk user ini', user.username, user.role);
    return res.status(403).json({ status: 'DENY', reason: 'Device ID tidak terdaftar untuk user ini' });
  }
  const accessToken = jwt.sign({ username: user.username, role: user.role, nim: user.nim }, config.jwtSecret,
    { subject: String(user.id), expiresIn: tokenLifetime.access });
  const refreshToken = randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO refresh_tokens (token, user_id, device_id, expires_at, revoked)
    VALUES (?, ?, ?, ?, 0)`).run(refreshToken, user.id, deviceId, Date.now() + tokenLifetime.refreshMs);
  authAudit(req, 'ALLOW', 'Login berhasil dan device terverifikasi', user.username, user.role);
  return res.json({ access_token: accessToken, refresh_token: refreshToken, expires_in: tokenLifetime.access,
    user: { id: user.id, username: user.username, role: user.role, nim: user.nim, device_id: user.device_id } });
});

app.post('/auth/refresh', (req, res) => {
  const token = req.body?.refresh_token;
  const row = db.prepare(`SELECT rt.*, u.username, u.role, u.nim FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id WHERE rt.token = ?`).get(String(token ?? ''));
  if (!row || row.revoked || row.expires_at < Date.now()) {
    authAudit(req, 'DENY', 'Refresh token tidak valid, kedaluwarsa, atau sudah dicabut', row?.username ?? 'anonymous', row?.role ?? 'none');
    return res.status(401).json({ status: 'DENY', reason: 'Refresh token tidak valid, kedaluwarsa, atau sudah dicabut' });
  }
  if (!req.get('X-Device-ID') || req.get('X-Device-ID') !== row.device_id) {
    authAudit(req, 'DENY', 'Device ID tidak cocok dengan pemilik refresh token', row.username, row.role);
    return res.status(403).json({ status: 'DENY', reason: 'Device ID tidak cocok dengan pemilik refresh token' });
  }
  const accessToken = jwt.sign({ username: row.username, role: row.role, nim: row.nim }, config.jwtSecret,
    { subject: String(row.user_id), expiresIn: tokenLifetime.access });
  authAudit(req, 'ALLOW', 'Refresh token valid; access token baru diterbitkan', row.username, row.role);
  return res.json({ access_token: accessToken, expires_in: tokenLifetime.access });
});

app.post('/auth/logout', (req, res) => {
  const token = req.body?.refresh_token;
  const row = db.prepare(`SELECT rt.*, u.username, u.role FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id WHERE rt.token = ?`).get(String(token ?? ''));
  if (!row || row.revoked) {
    authAudit(req, 'DENY', 'Refresh token tidak ditemukan atau sudah dicabut', row?.username ?? 'anonymous', row?.role ?? 'none');
    return res.status(401).json({ status: 'DENY', reason: 'Refresh token tidak ditemukan atau sudah dicabut' });
  }
  const deviceId = req.get('X-Device-ID');
  if (deviceId && deviceId !== row.device_id) {
    authAudit(req, 'DENY', 'Device ID tidak cocok dengan pemilik refresh token', row.username, row.role);
    return res.status(403).json({ status: 'DENY', reason: 'Device ID tidak cocok dengan pemilik refresh token' });
  }
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(token);
  authAudit(req, 'ALLOW', 'Logout berhasil, refresh token dicabut', row.username, row.role);
  return res.json({ message: 'Logout berhasil, refresh token telah dicabut' });
});

app.post('/auth/service', (req, res) => {
  const { client_id: clientId, client_secret: clientSecret } = req.body ?? {};
  if (clientId !== config.serviceClientId || clientSecret !== config.serviceClientSecret) {
    authAudit(req, 'DENY', 'Client ID atau secret service tidak valid');
    return res.status(401).json({ status: 'DENY', reason: 'Client ID atau secret service tidak valid' });
  }
  const serviceToken = jwt.sign({ role: 'service' }, config.jwtSecret,
    { subject: config.serviceClientId, expiresIn: tokenLifetime.service });
  authAudit(req, 'ALLOW', 'Token service diterbitkan untuk service-nilai', config.serviceClientId, 'service');
  return res.json({ service_token: serviceToken, expires_in: tokenLifetime.service });
});

app.all('*', async (req, res) => {
  const decision = evaluatePolicy(req);
  writeAudit({ subject: decision.subject ?? 'anonymous', role: decision.role ?? 'none', endpoint: `${req.method} ${req.path}`,
    deviceId: decision.deviceId ?? req.get('X-Device-ID') ?? 'none', result: decision.allow ? 'ALLOW' : 'DENY', reason: decision.reason });
  if (!decision.allow) return res.status(decision.status).json({ status: 'DENY', reason: decision.reason });
  if (req.path === '/audit-logs') {
    return res.json({ logs: db.prepare('SELECT * FROM audit_logs ORDER BY id').all() });
  }
  const targetPort = req.path.startsWith('/transkrip') ? config.transkripPort : config.nilaiPort;
  const headers = { 'X-Gateway-Secret': config.gatewaySecret };
  if (req.get('Authorization')) headers.Authorization = req.get('Authorization');
  if (req.get('Content-Type')) headers['Content-Type'] = req.get('Content-Type');
  const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  try {
    const upstream = await fetch(`http://127.0.0.1:${targetPort}${req.path}${query}`, {
      method: req.method, headers, body: hasBody ? JSON.stringify(req.body) : undefined,
    });
    const body = await upstream.text();
    res.status(upstream.status);
    if (upstream.headers.get('content-type')) res.set('Content-Type', upstream.headers.get('content-type'));
    return res.send(body);
  } catch (error) {
    console.error(`[GATEWAY] Upstream error: ${error.message}`);
    return res.status(502).json({ error: 'Service tujuan tidak dapat dijangkau' });
  }
});

app.use((error, _req, res, _next) => {
  console.error(`[GATEWAY] ${error.message}`);
  return res.status(400).json({ error: 'Body JSON tidak valid' });
});

app.listen(config.gatewayPort, '0.0.0.0', () => console.log(`API Gateway berjalan di port ${config.gatewayPort}`));
