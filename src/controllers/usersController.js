// src/controllers/usersController.js
const db = require('../db');
const { isRutValid, normalizeRutForStorage } = require('../utils/rutUtils');

const VALID_USER_STATES = new Set(['pendiente', 'activo', 'vencido']);
const VALID_ROLES       = new Set(['admin', 'profesor', 'usuario']);
const VALID_SEDES       = new Set(['Hualpen (Region del Biobio)', 'Coyhaique (Region de Aysen)']);
const VALID_CARGOS      = new Set([
  'Pendiente de asignacion', 'Direccion y Administracion', 'Enfermeria',
  'Cuidados Directos (TENS/Gerocultor)', 'Kinesiologia y Rehabilitacion',
  'Terapia Ocupacional', 'Psicologia', 'Trabajo Social', 'Nutricion y Alimentacion',
  'Recreacion y Actividades', 'Aseo e Higiene', 'Lavanderia y Roperia',
  'Mantencion y Servicios Generales', 'Cocina',
]);

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeRoles(raw) {
  if (Array.isArray(raw)) {
    const cleaned = raw.map((r) => String(r || '').trim().toLowerCase()).filter((r) => VALID_ROLES.has(r));
    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : ['usuario'];
  }
  if (raw === undefined || raw === null) return ['usuario'];
  const role = String(raw).trim().toLowerCase();
  return VALID_ROLES.has(role) ? [role] : ['usuario'];
}

function isExpiredDate(f) {
  if (!f) return false;
  const p = new Date(f);
  return !Number.isNaN(p.getTime()) && p.getTime() <= Date.now();
}

function normalizeEstado(rawEstado, fechaExpiracion) {
  const base = VALID_USER_STATES.has(String(rawEstado || '').trim().toLowerCase())
    ? String(rawEstado).trim().toLowerCase() : 'activo';
  return isExpiredDate(fechaExpiracion) ? 'vencido' : base;
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

async function getRolesForUser(userId) {
  const result = await db.query('SELECT rol FROM usuario_roles WHERE usuario_id = $1', [userId]);
  return result.rows.map((r) => r.rol);
}

function buildUserResponse(u, roles, sedeNombre) {
  return {
    id:              String(u.id),
    email:           u.email,
    nombre:          u.nombre,
    nombreCompleto:  u.nombre_completo,
    genero:          u.genero,
    rut:             u.rut,
    sede:            sedeNombre || null,
    cargo:           u.cargo,
    estado:          u.estado,
    rol:             roles,
    fechaRegistro:   u.fecha_registro   ? new Date(u.fecha_registro).toISOString()   : null,
    fechaExpiracion: u.fecha_expiracion ? new Date(u.fecha_expiracion).toISOString() : null,
    firmaTexto:         u.firma_texto            || undefined,
    firmaImagenDataUrl: u.firma_imagen_data_url  || undefined,
  };
}

const listarUsuarios = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.*, s.nombre AS sede_nombre
       FROM usuarios u
       LEFT JOIN sedes s ON s.id = u.sede_id
       ORDER BY u.fecha_registro DESC`
    );

    // Sincronizar vencidos
    const toUpdate = result.rows.filter((u) => isExpiredDate(u.fecha_expiracion) && u.estado !== 'vencido');
    await Promise.all(toUpdate.map((u) =>
      db.query('UPDATE usuarios SET estado = $1 WHERE id = $2', ['vencido', u.id])
    ));

    const users = await Promise.all(result.rows.map(async (u) => {
      const roles  = await getRolesForUser(u.id);
      const estado = isExpiredDate(u.fecha_expiracion) ? 'vencido' : u.estado;
      return buildUserResponse({ ...u, estado }, roles, u.sede_nombre);
    }));

    return res.status(200).json(users);
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    return res.status(500).json({ mensaje: 'No se pudieron obtener los usuarios' });
  }
};

const actualizarUsuario = async (req, res) => {
  try {
    const userId = String(req.params?.id || '');
    if (!userId) return res.status(400).json({ mensaje: 'ID de usuario invalido' });

    const userResult = await db.query(
      `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u
       LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    const user = userResult.rows[0];

    const payload = req.body || {};
    const rutRaw  = payload?.rut;
    const rut     = rutRaw === undefined ? undefined : normalizeRutForStorage(rutRaw);

    if (rutRaw !== undefined && (!rut || !isRutValid(rut)))
      return res.status(400).json({ mensaje: 'RUT invalido' });

    const sede  = asTrimmedString(payload?.sede);
    const cargo = asTrimmedString(payload?.cargo);

    if (sede  !== undefined && !VALID_SEDES.has(sede))   return res.status(400).json({ mensaje: 'Sede invalida' });
    if (cargo !== undefined && !VALID_CARGOS.has(cargo)) return res.status(400).json({ mensaje: 'Cargo invalido' });

    const parsedFecha = parseFechaExpiracion(payload?.fechaExpiracion);
    if (parsedFecha === 'invalid') return res.status(400).json({ mensaje: 'fechaExpiracion debe ser ISO date o null' });

    const fields = [];
    const values = [];
    let   paramIdx = 1;

    const nombre         = asTrimmedString(payload?.nombre);
    const nombreCompleto = asTrimmedString(payload?.nombreCompleto);
    const email          = asTrimmedString(payload?.email);

    if (nombre         !== undefined) { fields.push(`nombre = $${paramIdx++}`);          values.push(nombre); }
    if (nombreCompleto !== undefined) { fields.push(`nombre_completo = $${paramIdx++}`); values.push(nombreCompleto); }
    if (rut            !== undefined) { fields.push(`rut = $${paramIdx++}`);             values.push(rut); }
    if (email          !== undefined) { fields.push(`email = $${paramIdx++}`);           values.push(email.toLowerCase()); }
    if (cargo          !== undefined) { fields.push(`cargo = $${paramIdx++}`);           values.push(cargo); }

    if (sede !== undefined) {
      const sedeResult = await db.query('SELECT id FROM sedes WHERE nombre = $1', [sede]);
      if (sedeResult.rows.length === 0) return res.status(400).json({ mensaje: 'Sede no encontrada' });
      fields.push(`sede_id = $${paramIdx++}`);
      values.push(sedeResult.rows[0].id);
    }

    if (parsedFecha !== undefined) { fields.push(`fecha_expiracion = $${paramIdx++}`); values.push(parsedFecha); }

    const fechaParaEstado     = parsedFecha !== undefined ? parsedFecha : user.fecha_expiracion;
    const requestedEstado     = asTrimmedString(payload?.estado)?.toLowerCase();
    const currentEstado       = String(user.estado || '').toLowerCase();
    let   nuevoEstado;

    if (currentEstado === 'pendiente')                    nuevoEstado = 'activo';
    else if (requestedEstado) {
      if (!VALID_USER_STATES.has(requestedEstado)) return res.status(400).json({ mensaje: 'estado invalido' });
      nuevoEstado = requestedEstado;
    } else nuevoEstado = normalizeEstado(user.estado, fechaParaEstado);
    if (isExpiredDate(fechaParaEstado)) nuevoEstado = 'vencido';

    fields.push(`estado = $${paramIdx++}`);
    values.push(nuevoEstado);

    if (fields.length > 0) {
      values.push(userId);
      await db.query(`UPDATE usuarios SET ${fields.join(', ')} WHERE id = $${paramIdx}`, values);
    }

    if (payload?.rol !== undefined) {
      const newRoles = normalizeRoles(payload.rol);
      await db.query('DELETE FROM usuario_roles WHERE usuario_id = $1', [userId]);
      await Promise.all(newRoles.map((r) =>
        db.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, r])
      ));
    }

    const updated     = (await db.query(
      `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u
       LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.id = $1`, [userId]
    )).rows[0];
    const updatedRoles = await getRolesForUser(userId);

    return res.status(200).json({ success: true, usuario: buildUserResponse(updated, updatedRoles, updated.sede_nombre) });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    return res.status(500).json({ mensaje: 'No se pudo actualizar el usuario' });
  }
};

module.exports = { listarUsuarios, actualizarUsuario };
