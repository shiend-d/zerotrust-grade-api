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
  if (!match) return res.status(401).json({ error: 'Verifikasi ulang token di Service Transkrip gagal.' });
  try { req.user = jwt.verify(match[1], config.jwtSecret); }
  catch { return res.status(401).json({ error: 'Verifikasi ulang token di Service Transkrip gagal.' }); }
  next();
});

app.get('/transkrip/:nim', (req, res) => {
  if (!['mahasiswa', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Role tidak diizinkan melihat transkrip' });
  if (req.user.role === 'mahasiswa' && req.user.nim !== req.params.nim) return res.status(403).json({ error: 'Mahasiswa hanya boleh melihat transkrip miliknya sendiri' });
  const records = db.prepare(`SELECT kelas_id, kode_kelas, nama_mk, sks, nilai_angka, nilai_huruf, synced_at
    FROM transkrip WHERE nim = ? ORDER BY kelas_id`).all(req.params.nim);
  return res.json({ nim: req.params.nim, records, total_sks: records.reduce((total, row) => total + row.sks, 0) });
});

app.post('/transkrip/sinkron', (req, res) => {
  if (req.user.role !== 'service' || req.user.sub !== config.serviceClientId) return res.status(403).json({ error: 'Sinkronisasi hanya menerima token service-nilai' });
  const kelasId = Number(req.body?.kelas_id);
  const room = db.prepare('SELECT id, is_finalized FROM kelas WHERE id = ?').get(kelasId);
  if (!room || !room.is_finalized) return res.status(400).json({ error: 'Kelas tidak ditemukan atau belum difinalisasi' });
  if (!Array.isArray(req.body?.records)) return res.status(400).json({ error: 'records harus berupa array' });
  const upsert = db.prepare(`INSERT INTO transkrip
    (nim, kelas_id, kode_kelas, nama_mk, sks, nilai_angka, nilai_huruf, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(nim, kelas_id) DO UPDATE SET kode_kelas=excluded.kode_kelas,
      nama_mk=excluded.nama_mk, sks=excluded.sks, nilai_angka=excluded.nilai_angka,
      nilai_huruf=excluded.nilai_huruf, synced_at=excluded.synced_at`);
  const syncedAt = new Date().toISOString();
  let count = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const record of req.body.records) {
      if (Number(record.kelas_id) !== kelasId || !record.nim || !record.kode_kelas || !record.nama_mk ||
          !Number.isFinite(Number(record.sks)) || !Number.isFinite(Number(record.nilai_angka)) || !record.nilai_huruf) {
        throw new Error('Record nilai tidak lengkap atau kelas tidak sesuai');
      }
      const finalGrade = db.prepare('SELECT is_final FROM nilai WHERE kelas_id = ? AND nim = ?').get(kelasId, record.nim);
      if (!finalGrade?.is_final) throw new Error(`Nilai mahasiswa ${record.nim} belum final`);
      upsert.run(record.nim, kelasId, record.kode_kelas, record.nama_mk, Number(record.sks),
        Number(record.nilai_angka), String(record.nilai_huruf), syncedAt);
      count += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: error.message });
  }
  return res.json({ message: 'Transkrip berhasil disinkronkan', kelas_id: kelasId, synced_count: count });
});

app.use((_req, res) => res.status(404).json({ error: 'Endpoint Service Transkrip tidak ditemukan' }));
app.listen(config.transkripPort, '0.0.0.0', () => console.log(`Service Transkrip berjalan di port ${config.transkripPort}`));
