import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  if (req.get('X-Gateway-Secret') !== config.gatewaySecret) {
    return res.status(403).json({ error: 'Direct access ditolak! Request wajib melewati API Gateway (X-Gateway-Secret tidak valid).' });
  }
  const match = (req.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Verifikasi ulang token di Service Nilai gagal: Token tidak valid walaupun membawa X-Gateway-Secret.' });
  try { req.user = jwt.verify(match[1], config.jwtSecret); }
  catch { return res.status(401).json({ error: 'Verifikasi ulang token di Service Nilai gagal: Token tidak valid walaupun membawa X-Gateway-Secret.' }); }
  next();
});

app.get('/nilai', (req, res) => {
  if (req.user.role === 'mahasiswa') {
    const values = db.prepare(`SELECT n.id, n.kelas_id, k.kode_kelas, k.nama_mk, k.sks,
      n.nim, n.nilai_angka, n.nilai_huruf, n.is_final FROM nilai n JOIN kelas k ON k.id = n.kelas_id
      WHERE n.nim = ? ORDER BY n.id`).all(req.user.nim);
    return res.json({ values });
  }
  if (req.user.role === 'dosen') {
    const values = db.prepare(`SELECT n.id, n.kelas_id, k.kode_kelas, k.nama_mk, k.sks,
      n.nim, n.nilai_angka, n.nilai_huruf, n.is_final FROM nilai n JOIN kelas k ON k.id = n.kelas_id
      WHERE k.dosen_id = ? ORDER BY n.id`).all(Number(req.user.sub));
    return res.json({ values });
  }
  return res.status(403).json({ error: 'Role tidak diizinkan melihat nilai' });
});

app.put('/nilai/:id', (req, res) => {
  const nilaiAngka = Number(req.body?.nilai_angka);
  const nilaiHuruf = req.body?.nilai_huruf;
  if (!Number.isFinite(nilaiAngka) || nilaiAngka < 0 || nilaiAngka > 100 || typeof nilaiHuruf !== 'string' || !nilaiHuruf.trim()) {
    return res.status(400).json({ error: 'nilai_angka harus 0-100 dan nilai_huruf wajib diisi' });
  }
  const row = db.prepare(`SELECT n.id, n.is_final, k.dosen_id, k.is_finalized
    FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Data nilai tidak ditemukan' });
  if (req.user.role !== 'dosen' || row.dosen_id !== Number(req.user.sub)) return res.status(403).json({ error: 'Dosen bukan pengampu kelas ini' });
  if (row.is_final || row.is_finalized) return res.status(403).json({ error: 'Nilai sudah difinalisasi dan tidak dapat diubah lagi' });
  db.prepare('UPDATE nilai SET nilai_angka = ?, nilai_huruf = ? WHERE id = ?').run(nilaiAngka, nilaiHuruf.trim(), row.id);
  return res.json({ value: db.prepare(`SELECT n.id, n.kelas_id, n.nim, n.nilai_angka, n.nilai_huruf, n.is_final,
    k.kode_kelas, k.nama_mk FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?`).get(row.id) });
});

app.post('/kelas/:id/finalisasi', async (req, res) => {
  const roomId = Number(req.params.id);
  const room = db.prepare('SELECT * FROM kelas WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  if (req.user.role !== 'dosen' || room.dosen_id !== Number(req.user.sub)) return res.status(403).json({ error: 'Dosen bukan pengampu kelas ini' });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE kelas SET is_finalized = 1 WHERE id = ?').run(roomId);
    db.prepare('UPDATE nilai SET is_final = 1 WHERE kelas_id = ?').run(roomId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Gagal memfinalisasi kelas' });
  }
  const records = db.prepare(`SELECT n.nim, n.kelas_id, k.kode_kelas, k.nama_mk, k.sks,
    n.nilai_angka, n.nilai_huruf FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE k.id = ?`).all(roomId);
  try {
    const tokenResponse = await fetch(`http://127.0.0.1:${config.gatewayPort}/auth/service`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.serviceClientId, client_secret: config.serviceClientSecret }),
    });
    const tokenJson = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenJson.reason ?? 'Token service gagal diterbitkan');
    const syncResponse = await fetch(`http://127.0.0.1:${config.gatewayPort}/transkrip/sinkron`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenJson.service_token}` },
      body: JSON.stringify({ kelas_id: roomId, records }),
    });
    const syncJson = await syncResponse.json();
    if (!syncResponse.ok) return res.status(502).json({ finalized: true, synchronization: 'failed', details: syncJson });
    return res.json({ message: 'Kelas berhasil difinalisasi', finalized: true, synchronization: syncJson });
  } catch (error) {
    return res.status(502).json({ finalized: true, synchronization: 'failed', error: error.message });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Endpoint Service Nilai tidak ditemukan' }));
app.listen(config.nilaiPort, '127.0.0.1', () => console.log(`Service Nilai berjalan di port ${config.nilaiPort}`));
