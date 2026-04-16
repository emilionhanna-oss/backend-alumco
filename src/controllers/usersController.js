const fs = require('fs/promises');
const path = require('path');
const { isRutValid, normalizeRutForStorage } = require('../utils/rutUtils');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');
const VALID_USER_STATES = new Set(['pendiente', 'activo', 'vencido']);
const VALID_ROLES = new Set(['admin', 'profesor', 'usuario']);
const VALID_SEDES = new Set([
  'Hualpén (Región del Biobío)',
  'Coyhaique (Región de Aysén)',
]);
const VALID_CARGOS = new Set([
  'Pendiente de asignación',
  'Dirección y Administración',
  'Enfermería',
  'Cuidados Directos (TENS/Gerocultor)',
  'Kinesiología y Rehabilitación',
  'Terapia Ocupacional',
  'Psicología',
  'Trabajo Social',
  'Nutrición y Alimentación',
  'Recreación y Actividades',
  'Aseo e Higiene',
  'Lavandería y Ropería',
  'Mantención y Servicios Generales',
  'Cocina',
]);

async function readDb() {
  const raw = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function writeDb(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2) + '\n', 'utf-8');
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

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

function parseFechaExpiracion(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') return 'invalid';

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return 'invalid';
  return parsed.toISOString();
}

function isExpiredDate(fechaExpiracion) {
  if (!fechaExpiracion) return false;
  const parsed = new Date(fechaExpiracion);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= Date.now();
}

function normalizeEstado(rawEstado, fechaExpiracion) {
  const fromRaw = String(rawEstado || '').trim().toLowerCase();
  const base = VALID_USER_STATES.has(fromRaw) ? fromRaw : 'activo';
  if (isExpiredDate(fechaExpiracion)) return 'vencido';
  return base;
}

function sanitizeUserForResponse(u) {
  return {
    id: u?.id !== undefined ? String(u.id) : undefined,
    email: u?.email,
    nombre: u?.nombre,
    nombreCompleto: u?.nombreCompleto,
    genero: u?.genero,
    rut: u?.rut,
    sede: u?.sede,
    cargo: u?.cargo,
    estado: u?.estado,
    rol: normalizeRoles(u?.rol),
    fechaRegistro: u?.fechaRegistro || null,
    fechaExpiracion: u?.fechaExpiracion ?? null,
    firmaTexto: u?.firmaTexto,
    firmaImagenDataUrl: u?.firmaImagenDataUrl,
  };
}

function synchronizeExpiredUsers(usuarios) {
  let changed = false;

  const next = usuarios.map((u) => {
    const fechaExpiracion = u?.fechaExpiracion ?? null;
    const shouldExpire = isExpiredDate(fechaExpiracion);
    const normalizedRole = normalizeRoles(u?.rol);
    const normalizedRut = normalizeRutForStorage(u?.rut);
    const normalizedEstado = shouldExpire
      ? 'vencido'
      : normalizeEstado(u?.estado, fechaExpiracion);

    const candidate = {
      ...u,
      rut: normalizedRut,
      rol: normalizedRole,
      estado: normalizedEstado,
      fechaRegistro: u?.fechaRegistro || new Date().toISOString(),
      fechaExpiracion,
    };

    const before = JSON.stringify({
      rol: u?.rol,
      estado: u?.estado,
      fechaRegistro: u?.fechaRegistro,
      fechaExpiracion: u?.fechaExpiracion,
    });
    const after = JSON.stringify({
      rol: candidate.rol,
      estado: candidate.estado,
      fechaRegistro: candidate.fechaRegistro,
      fechaExpiracion: candidate.fechaExpiracion,
    });

    if (before !== after) changed = true;
    return candidate;
  });

  return { changed, usuarios: next };
}

const listarUsuarios = async (req, res) => {
  try {
    const db = await readDb();
    const usuarios = Array.isArray(db?.usuarios) ? db.usuarios : [];

    const synced = synchronizeExpiredUsers(usuarios);
    if (synced.changed) {
      await writeDb({ ...db, usuarios: synced.usuarios });
    }

    const sanitized = synced.usuarios.map(sanitizeUserForResponse);

    return res.status(200).json(sanitized);
  } catch (error) {
    console.error('Error al leer usuarios:', error);
    return res.status(500).json({ mensaje: 'No se pudieron obtener los usuarios' });
  }
};

const actualizarUsuario = async (req, res) => {
  try {
    const userId = String(req.params?.id || '');
    if (!userId) {
      return res.status(400).json({ mensaje: 'ID de usuario inválido' });
    }

    const db = await readDb();
    const usuarios = Array.isArray(db?.usuarios) ? db.usuarios : [];

    const idx = usuarios.findIndex((u) => String(u?.id) === userId);
    if (idx === -1) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    const payload = req.body || {};
    const current = usuarios[idx];
    const next = { ...current };

    const nombre = asTrimmedString(payload?.nombre);
    const nombreCompleto = asTrimmedString(payload?.nombreCompleto);
    const rutRaw = payload?.rut;
    const sede = asTrimmedString(payload?.sede);
    const cargo = asTrimmedString(payload?.cargo);
    const email = asTrimmedString(payload?.email);
    const rut = rutRaw === undefined ? undefined : normalizeRutForStorage(rutRaw);

    if (rutRaw !== undefined && (!rut || !isRutValid(rut))) {
      return res.status(400).json({ mensaje: 'RUT inválido' });
    }

    if (sede !== undefined && !VALID_SEDES.has(sede)) {
      return res.status(400).json({
        mensaje: 'sede inválida. Usa Hualpén (Región del Biobío) o Coyhaique (Región de Aysén)',
      });
    }

    if (cargo !== undefined && !VALID_CARGOS.has(cargo)) {
      return res.status(400).json({ mensaje: 'cargo inválido para el catálogo de áreas.' });
    }

    if (nombre !== undefined) next.nombre = nombre;
    if (nombreCompleto !== undefined) next.nombreCompleto = nombreCompleto;
    if (rut !== undefined) next.rut = rut;
    if (sede !== undefined) next.sede = sede;
    if (cargo !== undefined) next.cargo = cargo;
    if (email !== undefined) next.email = email.toLowerCase();

    if (payload?.rol !== undefined) {
      next.rol = normalizeRoles(payload.rol);
    } else {
      next.rol = normalizeRoles(next.rol);
    }

    const parsedFechaExpiracion = parseFechaExpiracion(payload?.fechaExpiracion);
    if (parsedFechaExpiracion === 'invalid') {
      return res.status(400).json({ mensaje: 'fechaExpiracion debe ser ISO date o null' });
    }
    if (parsedFechaExpiracion !== undefined) {
      next.fechaExpiracion = parsedFechaExpiracion;
    } else {
      next.fechaExpiracion = next?.fechaExpiracion ?? null;
    }

    const requestedEstado = asTrimmedString(payload?.estado)?.toLowerCase();
    const fromPendingToActive = String(current?.estado || '').toLowerCase() === 'pendiente';

    if (fromPendingToActive) {
      next.estado = 'activo';
    } else if (requestedEstado) {
      if (!VALID_USER_STATES.has(requestedEstado)) {
        return res.status(400).json({ mensaje: 'estado inválido. Usa pendiente, activo o vencido' });
      }
      next.estado = requestedEstado;
    } else {
      next.estado = normalizeEstado(next?.estado, next?.fechaExpiracion);
    }

    if (isExpiredDate(next.fechaExpiracion)) {
      next.estado = 'vencido';
    }

    next.fechaRegistro = next?.fechaRegistro || new Date().toISOString();

    usuarios[idx] = next;
    await writeDb({ ...db, usuarios });

    return res.status(200).json({ success: true, usuario: sanitizeUserForResponse(next) });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    return res.status(500).json({ mensaje: 'No se pudo actualizar el usuario' });
  }
};

module.exports = {
  listarUsuarios,
  actualizarUsuario,
};
