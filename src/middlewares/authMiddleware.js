// src/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const db  = require('../db');

const SECRET_KEY = process.env.JWT_SECRET || 'dev_insecure_change_me';
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

function isExpiredDate(fechaExpiracion) {
  if (!fechaExpiracion) return false;
  const parsed = new Date(fechaExpiracion);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= Date.now();
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ mensaje: 'No autorizado' });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);

    const userId = decoded?.id !== undefined ? String(decoded.id) : undefined;
    if (!userId) return res.status(401).json({ mensaje: 'No autorizado' });

    // Buscar usuario en PostgreSQL
    const result = await db.query(
      'SELECT * FROM usuarios WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ mensaje: 'No autorizado' });
    }

    const current = result.rows[0];
    const expired = isExpiredDate(current.fecha_expiracion);

    // Sincronizar estado vencido si corresponde
    if (expired && current.estado !== 'vencido') {
      await db.query('UPDATE usuarios SET estado = $1 WHERE id = $2', ['vencido', userId]);
      current.estado = 'vencido';
    }

    const effectiveState = expired ? 'vencido' : String(current.estado || 'activo').toLowerCase();

    if (effectiveState === 'pendiente') {
      return res.status(403).json({ mensaje: 'Acceso pendiente de aprobacion' });
    }

    if (effectiveState === 'vencido') {
      return res.status(403).json({ mensaje: 'Acceso vencido' });
    }

    // Obtener roles desde la tabla usuario_roles
    const rolesResult = await db.query(
      'SELECT rol FROM usuario_roles WHERE usuario_id = $1',
      [userId]
    );
    const roles = rolesResult.rows.map((r) => r.rol);

    req.user = {
      id:  userId,
      rol: normalizeRoles(roles),
    };

    return next();
  } catch {
    return res.status(401).json({ mensaje: 'Token invalido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  const roles = normalizeRoles(req.user?.rol);
  if (!roles.includes('admin')) {
    return res.status(403).json({ mensaje: 'No autorizado' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
