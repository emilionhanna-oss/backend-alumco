// src/controllers/userProfileController.js
const db = require('../db');
const { isRutValid, normalizeRutForStorage } = require('../utils/rutUtils');

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

const MAX_SIGNATURE_DATA_URL_CHARS = 350_000;

function sanitizeFirmaImagenDataUrl(value) {
  const v = asTrimmedString(value);
  if (!v) return undefined;
  if (v.length > MAX_SIGNATURE_DATA_URL_CHARS) return undefined;
  if (!/^data:image\/(png|jpeg|jpg);base64,[a-z0-9+/=\s]+$/i.test(v)) return undefined;
  return v;
}

async function getRolesForUser(userId) {
  const result = await db.query('SELECT rol FROM usuario_roles WHERE usuario_id = $1', [userId]);
  return result.rows.map((r) => r.rol);
}

function sanitizeUserForResponse(u, roles, sedeNombre) {
  if (!u) return null;
  return {
    id:                 String(u.id),
    email:              u.email,
    name:               u.nombre_completo || u.nombre || u.email,
    nombre:             u.nombre,
    nombreCompleto:     u.nombre_completo,
    genero:             u.genero,
    rol:                roles,
    rut:                u.rut,
    sede:               sedeNombre || null,
    cargo:              u.cargo,
    estado:             u.estado,
    fechaRegistro:      u.fecha_registro   ? new Date(u.fecha_registro).toISOString()   : null,
    fechaExpiracion:    u.fecha_expiracion ? new Date(u.fecha_expiracion).toISOString() : null,
    firmaTexto:         u.firma_texto            || undefined,
    firmaImagenDataUrl: u.firma_imagen_data_url  || undefined,
  };
}

const getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ mensaje: 'No autorizado' });

    const result = await db.query(
      `SELECT u.*, s.nombre AS sede_nombre
       FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id
       WHERE u.id = $1`,
      [userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado' });

    const user  = result.rows[0];
    const roles = await getRolesForUser(userId);
    return res.status(200).json(sanitizeUserForResponse(user, roles, user.sede_nombre));
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    return res.status(500).json({ mensaje: 'No se pudo obtener el perfil' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ mensaje: 'No autorizado' });

    const roles   = Array.isArray(req.user?.rol) ? req.user.rol.map(String) : [];
    const isAdmin = roles.includes('admin');

    const { nombre, nombreCompleto, genero, rut, cargo, firmaTexto, firmaImagenDataUrl } = req.body || {};

    if (rut !== undefined) {
      const rutNorm = normalizeRutForStorage(rut);
      if (!rutNorm || !isRutValid(rutNorm)) return res.status(400).json({ mensaje: 'RUT invalido' });
    }

    const fields = [];
    const values = [];
    let   paramIdx = 1;

    const n  = asTrimmedString(nombre);
    const nc = asTrimmedString(nombreCompleto);
    const g  = asTrimmedString(genero);
    const r  = rut !== undefined ? normalizeRutForStorage(rut) : undefined;
    const c  = asTrimmedString(cargo);

    if (n  !== undefined)           { fields.push(`nombre = $${paramIdx++}`);          values.push(n); }
    if (nc !== undefined)           { fields.push(`nombre_completo = $${paramIdx++}`); values.push(nc); }
    if (g  !== undefined)           { fields.push(`genero = $${paramIdx++}`);          values.push(g); }
    if (r  !== undefined)           { fields.push(`rut = $${paramIdx++}`);             values.push(r); }
    if (isAdmin && c !== undefined) { fields.push(`cargo = $${paramIdx++}`);           values.push(c); }

    const ft = asTrimmedString(firmaTexto);
    const fi = sanitizeFirmaImagenDataUrl(firmaImagenDataUrl);

    if (firmaTexto !== undefined) {
      fields.push(`firma_texto = $${paramIdx++}`);
      values.push(ft || null);
      if (ft) { fields.push(`firma_imagen_data_url = $${paramIdx++}`); values.push(null); }
    }
    if (firmaImagenDataUrl !== undefined) {
      fields.push(`firma_imagen_data_url = $${paramIdx++}`);
      values.push(fi || null);
      if (fi) { fields.push(`firma_texto = $${paramIdx++}`); values.push(null); }
    }

    if (fields.length > 0) {
      values.push(userId);
      await db.query(`UPDATE usuarios SET ${fields.join(', ')} WHERE id = $${paramIdx}`, values);
    }

    const updated = (await db.query(
      `SELECT u.*, s.nombre AS sede_nombre
       FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id
       WHERE u.id = $1`,
      [userId]
    )).rows[0];

    const updatedRoles = await getRolesForUser(userId);
    return res.status(200).json(sanitizeUserForResponse(updated, updatedRoles, updated.sede_nombre));
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    return res.status(500).json({ mensaje: 'No se pudo actualizar el perfil' });
  }
};

module.exports = { getProfile, updateProfile };
