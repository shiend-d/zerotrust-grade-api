import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

const denied = (status, reason, extra = {}) => ({ allow: false, status, reason, ...extra });

function currentHour(req) {
  const simulated = req.get('X-Simulated-Hour');
  if (simulated !== undefined && /^\d{1,2}$/.test(simulated) && Number(simulated) <= 23) return Number(simulated);
  return new Date().getHours();
}

export function evaluatePolicy(req) {
  const authorization = req.get('Authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return denied(401, 'Token tidak ada, tidak valid, atau sudah kedaluwarsa');
  let user;
  try {
    user = jwt.verify(match[1], config.jwtSecret);
  } catch {
    return denied(401, 'Token tidak ada, tidak valid, atau sudah kedaluwarsa');
  }

  const service = user.role === 'service' && user.sub === config.serviceClientId;
  const deviceId = req.get('X-Device-ID') ?? (service ? 'internal-service' : 'none');
  let subject = user.username ?? String(user.sub ?? 'unknown');
  if (!service) {
    const registered = db.prepare('SELECT id, username, role, nim, device_id FROM users WHERE id = ?').get(Number(user.sub));
    if (!registered) return denied(401, 'Pengguna token tidak ditemukan', { subject, role: user.role, deviceId });
    subject = registered.username;
    if (!deviceId || deviceId !== registered.device_id) {
      return denied(403, 'Device ID tidak terdaftar untuk user ini', { subject, role: registered.role, deviceId });
    }
  }

  const base = { subject, role: user.role, deviceId, decodedToken: user };
  const { method, path, params } = req;
  if (method === 'GET' && path === '/nilai') {
    if (['mahasiswa', 'dosen'].includes(user.role)) return { allow: true, reason: 'Akses melihat nilai diizinkan sesuai role', ...base };
    return denied(403, 'Role tidak diizinkan mengakses daftar nilai', base);
  }
  const gradeMatch = path.match(/^\/nilai\/(\d+)$/);
  if (method === 'PUT' && gradeMatch) {
    if (user.role !== 'dosen') return denied(403, 'Hanya dosen yang boleh mengubah nilai', base);
    const hour = currentHour(req);
    if (hour < config.accessStartHour || hour >= config.accessEndHour) {
      return denied(403, `Perubahan nilai ditolak: di luar jam akses operasional (${config.accessStartHour}.00-${config.accessEndHour}.00)`, base);
    }
    const row = db.prepare(`SELECT n.id, n.is_final, k.dosen_id, k.is_finalized
      FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?`).get(Number(gradeMatch[1]));
    if (!row) return denied(404, 'Data nilai tidak ditemukan', base);
    if (row.dosen_id !== Number(user.sub)) return denied(403, 'Ditolak: Anda bukan dosen pengampu untuk kelas dari nilai ini', base);
    if (row.is_final || row.is_finalized) return denied(403, 'Ditolak: Nilai sudah difinalisasi dan tidak dapat diubah lagi', base);
    return { allow: true, reason: 'Dosen pengampu sah, nilai belum final, dan dalam jam akses', ...base };
  }
  const classMatch = path.match(/^\/kelas\/(\d+)\/finalisasi$/);
  if (method === 'POST' && classMatch) {
    if (user.role !== 'dosen') return denied(403, 'Hanya dosen yang boleh memfinalisasi kelas', base);
    const hour = currentHour(req);
    if (hour < config.accessStartHour || hour >= config.accessEndHour) {
      return denied(403, `Finalisasi nilai ditolak: di luar jam akses operasional (${config.accessStartHour}.00-${config.accessEndHour}.00)`, base);
    }
    const room = db.prepare('SELECT id, dosen_id FROM kelas WHERE id = ?').get(Number(classMatch[1]));
    if (!room) return denied(404, 'Kelas tidak ditemukan', base);
    if (room.dosen_id !== Number(user.sub)) return denied(403, 'Ditolak: Anda bukan dosen pengampu kelas ini', base);
    return { allow: true, reason: 'Dosen pengampu sah dan dalam jam akses untuk finalisasi', ...base };
  }
  const transcriptMatch = path.match(/^\/transkrip\/([^/]+)$/);
  if (method === 'GET' && transcriptMatch) {
    if (!['mahasiswa', 'admin'].includes(user.role)) return denied(403, 'Role tidak diizinkan melihat transkrip', base);
    if (user.role === 'mahasiswa' && user.nim !== decodeURIComponent(transcriptMatch[1])) {
      return denied(403, 'Ditolak: Mahasiswa hanya boleh melihat transkrip miliknya sendiri', base);
    }
    return { allow: true, reason: 'Akses transkrip diizinkan', ...base };
  }
  if (method === 'POST' && path === '/transkrip/sinkron') {
    if (!service) return denied(403, 'Ditolak: Endpoint sinkronisasi transkrip hanya menerima token service', base);
    return { allow: true, reason: 'Token service valid untuk sinkronisasi transkrip', ...base };
  }
  if (method === 'GET' && path === '/audit-logs') {
    if (user.role !== 'admin') return denied(403, 'Hanya admin yang boleh melihat audit log', base);
    return { allow: true, reason: 'Audit log diakses oleh admin terverifikasi', ...base };
  }
  return denied(404, 'Endpoint tidak ditemukan', base);
}
