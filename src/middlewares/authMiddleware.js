const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const SECRET_KEY = process.env.JWT_SECRET || 'dev_insecure_change_me';
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');
const VALID_ROLES = new Set(['admin', 'profesor', 'usuario']);

function normalizeRoles(raw) {
  if (Array.isArray(raw)) {
    const cleaned = raw
      .map((r) => String(r || '').trim().toLowerCase())
      .filter((r) => VALID_ROLES.has(r));

    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : ['usuario'];
  }

  if (raw === undefined || raw === null) return ['usuario'];

  const role = String(raw).trim().toLowerCase();
  return VALID_ROLES.has(role) ? [role] : ['usuario'];
}

function readDb() {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n', 'utf-8');
}

function isExpiredDate(fechaExpiracion) {
  if (!fechaExpiracion) return false;
  const parsed = new Date(fechaExpiracion);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= Date.now();
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ mensaje: 'No autorizado' });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);

    req.user = {
      id: decoded?.id !== undefined ? String(decoded.id) : undefined,
      rol: normalizeRoles(decoded?.rol),
    };

    if (!req.user.id) {
      return res.status(401).json({ mensaje: 'No autorizado' });
    }

    const db = readDb();
    const usuarios = Array.isArray(db?.usuarios) ? db.usuarios : [];
    const idx = usuarios.findIndex((u) => String(u?.id) === String(req.user.id));

    if (idx === -1) {
      return res.status(401).json({ mensaje: 'No autorizado' });
    }

    const current = usuarios[idx];
    const expired = isExpiredDate(current?.fechaExpiracion);

    if (expired && String(current?.estado || '').toLowerCase() !== 'vencido') {
      usuarios[idx] = { ...current, estado: 'vencido' };
      writeDb({ ...db, usuarios });
    }

    const effectiveState = expired ? 'vencido' : String(current?.estado || 'activo').toLowerCase();

    if (effectiveState === 'pendiente') {
      return res.status(403).json({ mensaje: 'Acceso pendiente de aprobación' });
    }

    if (effectiveState === 'vencido') {
      return res.status(403).json({ mensaje: 'Acceso vencido' });
    }

    req.user.rol = normalizeRoles(current?.rol);

    return next();
  } catch {
    return res.status(401).json({ mensaje: 'Token inválido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  const roles = normalizeRoles(req.user?.rol);
  if (!roles.includes('admin')) {
    return res.status(403).json({ mensaje: 'No autorizado' });
  }
  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
};
