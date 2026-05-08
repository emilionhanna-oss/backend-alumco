// src/services/authService.js
const crypto = require('crypto');
const db = require('../db');
const { isRutValid, normalizeRutForStorage } = require('../utils/rutUtils');

const VALID_USER_STATES       = new Set(['pendiente', 'activo', 'vencido']);
const VALID_REGISTER_GENDERS  = new Set(['femenino', 'masculino', 'otro']);
const VALID_ROLES             = new Set(['admin', 'profesor', 'usuario']);
const REGISTER_DEFAULT_ROLE   = 'usuario';
const REGISTER_DEFAULT_CARGO  = 'Pendiente de asignacion';
const REGISTER_OFFICIAL_SEDES = [
  'Hualpen (Region del Biobio)',
  'Coyhaique (Region de Aysen)',
];

function normalizeRoles(raw) {
  if (Array.isArray(raw)) {
    const cleaned = raw.map((r) => String(r || '').trim().toLowerCase()).filter((r) => VALID_ROLES.has(r));
    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [REGISTER_DEFAULT_ROLE];
  }
  if (raw === undefined || raw === null) return [REGISTER_DEFAULT_ROLE];
  const role = String(raw).trim().toLowerCase();
  return VALID_ROLES.has(role) ? [role] : [REGISTER_DEFAULT_ROLE];
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword?.salt || !storedPassword?.hash) return false;
  const derived  = crypto.scryptSync(String(password), String(storedPassword.salt), 64).toString('hex');
  const expected = String(storedPassword.hash);
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expected, 'hex'));
}

function extractFirstName(nombreCompleto) {
  const source = asTrimmedString(nombreCompleto) || '';
  const [first = 'Usuario'] = source.split(/\s+/);
  return first;
}

function isExpiredDate(fechaExpiracion) {
  if (!fechaExpiracion) return false;
  const parsed = new Date(fechaExpiracion);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= Date.now();
}

function normalizeEstado(rawEstado, fechaExpiracion) {
  const state = String(rawEstado || '').trim().toLowerCase();
  const base  = VALID_USER_STATES.has(state) ? state : 'activo';
  return isExpiredDate(fechaExpiracion) ? 'vencido' : base;
}

function buildUserPublicData(user, roles) {
  return {
    id:              String(user.id),
    email:           user.email,
    nombre:          user.nombre,
    nombreCompleto:  user.nombre_completo,
    genero:          user.genero,
    rut:             user.rut,
    sede:            user.sede_nombre || null,
    cargo:           user.cargo,
    estado:          user.estado,
    rol:             normalizeRoles(roles),
    fechaRegistro:   user.fecha_registro   ? new Date(user.fecha_registro).toISOString()   : null,
    fechaExpiracion: user.fecha_expiracion ? new Date(user.fecha_expiracion).toISOString() : null,
  };
}

function listRegistrationSedes() {
  return [...REGISTER_OFFICIAL_SEDES];
}

async function getRolesForUser(userId) {
  const result = await db.query('SELECT rol FROM usuario_roles WHERE usuario_id = $1', [userId]);
  return result.rows.map((r) => r.rol);
}

async function register(payload) {
  const nombreCompleto  = asTrimmedString(payload?.nombreCompleto);
  const email           = asTrimmedString(payload?.email)?.toLowerCase();
  const password        = String(payload?.password || '');
  const confirmPassword = String(payload?.confirmPassword || '');
  const genero          = asTrimmedString(payload?.genero)?.toLowerCase();
  const sedeNombre      = asTrimmedString(payload?.sede);
  const rut             = normalizeRutForStorage(payload?.rut);

  if (!nombreCompleto)                               throw new Error('Nombre completo es obligatorio');
  if (!rut || !isRutValid(rut))                      throw new Error('RUT invalido');
  if (!genero || !VALID_REGISTER_GENDERS.has(genero)) throw new Error('Genero invalido');
  if (!email || !email.includes('@'))                throw new Error('Correo electronico invalido');
  if (!password || password.length < 6)              throw new Error('La contrasena debe tener al menos 6 caracteres');
  if (confirmPassword !== password)                  throw new Error('Las contrasenas no coinciden');

  if (!sedeNombre || !new Set(listRegistrationSedes()).has(sedeNombre))
    throw new Error('Debes seleccionar una sede valida');

  const emailCheck = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
  if (emailCheck.rows.length > 0) throw new Error('El correo electronico ya esta registrado');

  const rutCheck = await db.query('SELECT id FROM usuarios WHERE rut = $1', [rut]);
  if (rutCheck.rows.length > 0) throw new Error('El RUT ya esta registrado');

  const sedeResult = await db.query('SELECT id FROM sedes WHERE nombre = $1', [sedeNombre]);
  if (sedeResult.rows.length === 0) throw new Error('Sede no encontrada en la base de datos');
  const sedeId = sedeResult.rows[0].id;

  const { salt, hash } = hashPassword(password);
  const nombre = extractFirstName(nombreCompleto);

  const insertResult = await db.query(
    `INSERT INTO usuarios
       (email, password_hash, password_salt, nombre_completo, nombre, rut, genero, sede_id, cargo, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pendiente')
     RETURNING id`,
    [email, hash, salt, nombreCompleto, nombre, rut, genero, sedeId, REGISTER_DEFAULT_CARGO]
  );
  const newId = insertResult.rows[0].id;

  await db.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1,$2)', [newId, REGISTER_DEFAULT_ROLE]);

  return {
    id: String(newId), email, nombre, nombreCompleto, genero, rut,
    sede: sedeNombre, cargo: REGISTER_DEFAULT_CARGO,
    estado: 'pendiente', rol: [REGISTER_DEFAULT_ROLE],
    fechaRegistro: new Date().toISOString(), fechaExpiracion: null,
  };
}

async function login(credencial, password) {
  const email = String(credencial || '').trim().toLowerCase();

  const result = await db.query(
    `SELECT u.*, s.nombre AS sede_nombre
     FROM usuarios u
     LEFT JOIN sedes s ON s.id = u.sede_id
     WHERE u.email = $1`,
    [email]
  );

  if (result.rows.length === 0) throw new Error('Credenciales incorrectas');
  const user = result.rows[0];

  const valid = verifyPassword(password, { salt: user.password_salt, hash: user.password_hash });
  if (!valid) throw new Error('Credenciales incorrectas');

  const normalizedEstado = normalizeEstado(user.estado, user.fecha_expiracion);
  if (normalizedEstado !== user.estado) {
    await db.query('UPDATE usuarios SET estado = $1 WHERE id = $2', [normalizedEstado, user.id]);
    user.estado = normalizedEstado;
  }

  if (user.estado === 'pendiente') throw new Error('Tu acceso esta pendiente de aprobacion por un administrador.');
  if (user.estado === 'vencido')   throw new Error('Tu acceso se encuentra vencido. Contacta al administrador.');

  const roles = await getRolesForUser(user.id);
  return buildUserPublicData(user, roles);
}

module.exports = { login, register, listRegistrationSedes };
