import { DatabaseSync } from 'node:sqlite';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export const db = new DatabaseSync(config.databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

if (process.env.ZERO_TRUST_DB_READY !== '1') {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, nama TEXT NOT NULL, role TEXT NOT NULL,
    nim TEXT UNIQUE, device_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id), device_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS kelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kode_kelas TEXT UNIQUE NOT NULL,
    nama_mk TEXT NOT NULL, sks INTEGER NOT NULL,
    dosen_id INTEGER NOT NULL REFERENCES users(id), is_finalized INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS nilai (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kelas_id INTEGER NOT NULL REFERENCES kelas(id),
    nim TEXT NOT NULL, nilai_angka REAL NOT NULL, nilai_huruf TEXT NOT NULL,
    is_final INTEGER NOT NULL DEFAULT 0, UNIQUE(kelas_id, nim)
  );
  CREATE TABLE IF NOT EXISTS transkrip (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nim TEXT NOT NULL,
    kelas_id INTEGER NOT NULL, kode_kelas TEXT NOT NULL, nama_mk TEXT NOT NULL,
    sks INTEGER NOT NULL, nilai_angka REAL NOT NULL, nilai_huruf TEXT NOT NULL,
    synced_at TEXT NOT NULL, UNIQUE(nim, kelas_id)
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, waktu TEXT NOT NULL, subjek TEXT NOT NULL,
    role TEXT NOT NULL, endpoint TEXT NOT NULL, device_id TEXT NOT NULL,
    hasil TEXT NOT NULL CHECK (hasil IN ('ALLOW', 'DENY')), alasan TEXT NOT NULL
  );
  `);
}

export function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

export function passwordMatches(password, storedHash) {
  const actual = Buffer.from(hashPassword(password), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function seedDatabase() {
  const addUser = db.prepare(`INSERT OR IGNORE INTO users
    (id, username, password, nama, role, nim, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const users = [
    [1, 'admin', 'admin123', 'Admin Akademik', 'admin', null, 'dev-admin-01'],
    [2, 'dosen1', 'dosen123', 'Ir. Alam Rahmatulloh', 'dosen', null, 'dev-dosen-01'],
    [3, 'dosen2', 'dosen123', 'Dr. Siti Aminah', 'dosen', null, 'dev-dosen-02'],
    [4, 'mhs1', 'mhs123', 'Andi Pratama', 'mahasiswa', '237006001', 'dev-mhs-01'],
    [5, 'mhs2', 'mhs123', 'Budi Santoso', 'mahasiswa', '237006002', 'dev-mhs-02'],
    [6, 'mhs3', 'mhs123', 'Citra Lestari', 'mahasiswa', '237006003', 'dev-mhs-03'],
  ];
  for (const [id, username, password, nama, role, nim, device] of users) {
    addUser.run(id, username, hashPassword(password), nama, role, nim, device);
  }

  const addClass = db.prepare(`INSERT OR IGNORE INTO kelas
    (id, kode_kelas, nama_mk, sks, dosen_id, is_finalized) VALUES (?, ?, ?, ?, ?, 0)`);
  addClass.run(1, 'KP70065004', 'Keamanan Informasi', 3, 2);
  addClass.run(2, 'KP70065009', 'Keamanan Jaringan', 3, 3);
  const addGrade = db.prepare(`INSERT OR IGNORE INTO nilai
    (id, kelas_id, nim, nilai_angka, nilai_huruf, is_final) VALUES (?, ?, ?, ?, ?, 0)`);
  addGrade.run(1, 1, '237006001', 85, 'A');
  addGrade.run(2, 1, '237006002', 78, 'B');
  addGrade.run(3, 2, '237006001', 80, 'A-');
  addGrade.run(4, 2, '237006003', 88, 'A');
}

export function writeAudit({ subject = 'anonymous', role = 'none', endpoint, deviceId = 'none', result, reason }) {
  db.prepare(`INSERT INTO audit_logs (waktu, subjek, role, endpoint, device_id, hasil, alasan)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(new Date().toISOString(), subject, role, endpoint, deviceId, result, reason);
  console.log(`[AUDIT] ${result} ${subject} (${role}) ${endpoint} device=${deviceId} reason="${reason}"`);
}

if (process.env.ZERO_TRUST_DB_READY !== '1') seedDatabase();
