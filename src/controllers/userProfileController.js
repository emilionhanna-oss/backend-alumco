const fs = require('fs/promises');
const path = require('path');
const { isRutValid, normalizeRutForStorage } = require('../utils/rutUtils');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');

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

function sanitizeUserForResponse(u) {
  if (!u) return null;

  const email = u?.email;
  const name = u?.name || u?.nombreCompleto || u?.nombre || email;

  return {
    id: u?.id !== undefined ? String(u.id) : undefined,
    email,
    name,
    nombre: u?.nombre,
    nombreCompleto: u?.nombreCompleto,
    genero: u?.genero,
    rol: u?.rol,
    rut: u?.rut,
    sede: u?.sede,
    cargo: u?.cargo,
    estado: u?.estado,
    fechaRegistro: u?.fechaRegistro || null,
    fechaExpiracion: u?.fechaExpiracion ?? null,
    firmaTexto: u?.firmaTexto,
    firmaImagenDataUrl: u?.firmaImagenDataUrl,
  };
}

const MAX_SIGNATURE_DATA_URL_CHARS = 350_000; // ~260KB base64 aprox (dependiendo del contenido)

function sanitizeFirmaImagenDataUrl(value) {
  const v = asTrimmedString(value);
  if (!v) return undefined;

  if (v.length > MAX_SIGNATURE_DATA_URL_CHARS) return undefined;

  // Acepta solo data URLs de imágenes para evitar XSS/schemes peligrosos.
  // Ejemplo: data:image/png;base64,....
  if (!/^data:image\/(png|jpeg|jpg);base64,[a-z0-9+/=\s]+$/i.test(v)) return undefined;

  return v;
}

const getProfile = async (req, res) => {
  try {
    const userId = String(req.user?.id || '');
    if (!userId) return res.status(401).json({ mensaje: 'No autorizado' });

    const db = await readDb();
    const usuarios = Array.isArray(db?.usuarios) ? db.usuarios : [];

    const u = usuarios.find((x) => String(x?.id) === userId);
    if (!u) return res.status(404).json({ mensaje: 'Usuario no encontrado' });

    return res.status(200).json(sanitizeUserForResponse(u));
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    return res.status(500).json({ mensaje: 'No se pudo obtener el perfil' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const userId = String(req.user?.id || '');
    if (!userId) return res.status(401).json({ mensaje: 'No autorizado' });

    const roles = Array.isArray(req.user?.rol) ? req.user.rol.map(String) : [];
    const isAdmin = roles.includes('admin');

    const {
      nombre,
      nombreCompleto,
      genero,
      rut,
      cargo,
      firmaTexto,
      firmaImagenDataUrl,
    } = req.body || {};

    const db = await readDb();
    const usuarios = Array.isArray(db?.usuarios) ? db.usuarios : [];

    const idx = usuarios.findIndex((x) => String(x?.id) === userId);
    if (idx === -1) return res.status(404).json({ mensaje: 'Usuario no encontrado' });

    const next = { ...usuarios[idx] };

    const n = asTrimmedString(nombre);
    const nc = asTrimmedString(nombreCompleto);
    const g = asTrimmedString(genero);
    const r = rut !== undefined ? normalizeRutForStorage(rut) : undefined;
    const c = asTrimmedString(cargo);

    if (rut !== undefined && (!r || !isRutValid(r))) {
      return res.status(400).json({ mensaje: 'RUT inválido' });
    }

    // Campos de texto básicos (opcionales)
    if (n !== undefined) next.nombre = n;
    if (nc !== undefined) next.nombreCompleto = nc;
    if (g !== undefined) next.genero = g;
    if (r !== undefined) next.rut = r;
    if (isAdmin && c !== undefined) next.cargo = c;

    // Firma: permitimos texto o imagen (o borrar)
    const ft = asTrimmedString(firmaTexto);
    const fi = sanitizeFirmaImagenDataUrl(firmaImagenDataUrl);

    // Si viene explícitamente como string vacía, se interpreta como borrar.
    if (firmaTexto !== undefined) {
      next.firmaTexto = ft || undefined;
      if (ft) {
        // Si guardan texto, limpiamos imagen para evitar conflicto.
        next.firmaImagenDataUrl = undefined;
      }
    }

    if (firmaImagenDataUrl !== undefined) {
      next.firmaImagenDataUrl = fi;
      if (fi) {
        // Si guardan imagen, limpiamos texto para evitar conflicto.
        next.firmaTexto = undefined;
      }
    }

    usuarios[idx] = next;
    await writeDb({ ...db, usuarios });

    return res.status(200).json(sanitizeUserForResponse(next));
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    return res.status(500).json({ mensaje: 'No se pudo actualizar el perfil' });
  }
};

module.exports = {
  getProfile,
  updateProfile,
};
