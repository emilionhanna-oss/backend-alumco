// Archivo: src/services/authService.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isRutValid, normalizeRutForStorage } = require('../utils/rutUtils');

const DB_PATH = path.join(__dirname, '../../data/db.json');
const VALID_USER_STATES = new Set(['pendiente', 'activo', 'vencido']);
const VALID_REGISTER_GENDERS = new Set(['femenino', 'masculino', 'otro']);
const VALID_ROLES = new Set(['admin', 'profesor', 'usuario']);
const REGISTER_DEFAULT_ROLE = 'usuario';
const REGISTER_DEFAULT_CARGO = 'Pendiente de asignación';
const REGISTER_OFFICIAL_SEDES = [
    'Hualpén (Región del Biobío)',
    'Coyhaique (Región de Aysén)',
];

function readDb() {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
}

function writeDb(db) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n', 'utf-8');
}

function normalizeRoles(raw) {
    if (Array.isArray(raw)) {
        const cleaned = raw
            .map((r) => String(r || '').trim().toLowerCase())
            .filter((r) => VALID_ROLES.has(r));

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

function buildUserPublicData(user) {
    return {
        id: user?.id ? String(user.id) : undefined,
        email: user?.email,
        nombre: user?.nombre,
        nombreCompleto: user?.nombreCompleto,
        genero: user?.genero,
        rut: user?.rut,
        sede: user?.sede,
        cargo: user?.cargo,
        estado: user?.estado,
        rol: normalizeRoles(user?.rol),
        fechaRegistro: user?.fechaRegistro || null,
        fechaExpiracion: user?.fechaExpiracion ?? null,
    };
}

function extractFirstName(nombreCompleto) {
    const source = asTrimmedString(nombreCompleto) || '';
    const [first = 'Usuario'] = source.split(/\s+/);
    return first;
}

function generateSequentialUserId(existingUsers) {
    const numericIds = existingUsers
        .map((u) => Number.parseInt(String(u?.id || ''), 10))
        .filter((n) => Number.isInteger(n) && n > 0);

    if (numericIds.length === 0) return '1';
    return String(Math.max(...numericIds) + 1);
}

function listRegistrationSedes() {
    return [...REGISTER_OFFICIAL_SEDES];
}

function register(payload) {
    const db = readDb();
    const usuarios = Array.isArray(db?.usuarios) ? db.usuarios : [];

    const nombreCompleto = asTrimmedString(payload?.nombreCompleto);
    const email = asTrimmedString(payload?.email)?.toLowerCase();
    const password = String(payload?.password || '');
    const confirmPassword = String(payload?.confirmPassword || '');
    const genero = asTrimmedString(payload?.genero)?.toLowerCase();
    const sede = asTrimmedString(payload?.sede);
    const rut = normalizeRutForStorage(payload?.rut);

    if (!nombreCompleto) throw new Error('Nombre completo es obligatorio');
    if (!rut || !isRutValid(rut)) throw new Error('RUT inválido');
    if (!genero || !VALID_REGISTER_GENDERS.has(genero)) {
        throw new Error('Género inválido. Usa femenino, masculino u otro');
    }
    if (!email || !email.includes('@')) throw new Error('Correo electrónico inválido');
    if (!password || password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
    if (!confirmPassword || confirmPassword !== password) throw new Error('Las contraseñas no coinciden');

    const sedesPermitidas = new Set(listRegistrationSedes());
    if (!sede || !sedesPermitidas.has(sede)) {
        throw new Error('Debes seleccionar una sede válida');
    }

    const emailInUse = usuarios.some(
        (u) => String(u?.email || '').trim().toLowerCase() === email
    );
    if (emailInUse) throw new Error('El correo electrónico ya está registrado');

    const rutInUse = usuarios.some(
        (u) => normalizeRutForStorage(u?.rut) === rut
    );
    if (rutInUse) throw new Error('El RUT ya está registrado');

    const nowIso = new Date().toISOString();
    const newUser = {
        id: generateSequentialUserId(usuarios),
        email,
        password: hashPassword(password),
        nombre: extractFirstName(nombreCompleto),
        nombreCompleto,
        genero,
        rut,
        sede,
        cargo: REGISTER_DEFAULT_CARGO,
        estado: 'pendiente',
        rol: [REGISTER_DEFAULT_ROLE],
        fechaRegistro: nowIso,
        fechaExpiracion: null,
    };

    usuarios.push(newUser);
    writeDb({ ...db, usuarios });

    return buildUserPublicData(newUser);
}

function isExpiredDate(fechaExpiracion) {
    if (!fechaExpiracion) return false;
    const parsed = new Date(fechaExpiracion);
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.getTime() <= Date.now();
}

function normalizeEstado(rawEstado, fechaExpiracion) {
    const state = String(rawEstado || '').trim().toLowerCase();
    const base = VALID_USER_STATES.has(state) ? state : 'activo';
    if (isExpiredDate(fechaExpiracion)) return 'vencido';
    return base;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword?.salt || !storedPassword?.hash) return false;

    const derived = crypto
        .scryptSync(String(password), String(storedPassword.salt), 64)
        .toString('hex');

    const expected = String(storedPassword.hash);

    if (derived.length !== expected.length) return false;

    return crypto.timingSafeEqual(
        Buffer.from(derived, 'hex'),
        Buffer.from(expected, 'hex')
    );
}

const login = (credencial, password) => {
    const db = readDb();
    const usuarios = Array.isArray(db?.usuarios) ? db.usuarios : [];

    const email = String(credencial || '').trim().toLowerCase();

    const usuarioEncontrado = usuarios.find(
        (u) => String(u?.email || '').trim().toLowerCase() === email
    );

    if (!usuarioEncontrado || !verifyPassword(password, usuarioEncontrado.password)) {
        throw new Error('Credenciales incorrectas');
    }

    let shouldPersist = false;
    const normalizedRoles = normalizeRoles(usuarioEncontrado.rol);
    const fechaExpiracion = usuarioEncontrado.fechaExpiracion ?? null;
    const normalizedEstado = normalizeEstado(usuarioEncontrado.estado, fechaExpiracion);
    const fechaRegistro = usuarioEncontrado.fechaRegistro || new Date().toISOString();

    if (JSON.stringify(usuarioEncontrado.rol) !== JSON.stringify(normalizedRoles)) {
        usuarioEncontrado.rol = normalizedRoles;
        shouldPersist = true;
    }

    if (usuarioEncontrado.estado !== normalizedEstado) {
        usuarioEncontrado.estado = normalizedEstado;
        shouldPersist = true;
    }

    if (usuarioEncontrado.fechaRegistro !== fechaRegistro) {
        usuarioEncontrado.fechaRegistro = fechaRegistro;
        shouldPersist = true;
    }

    if (usuarioEncontrado.fechaExpiracion !== fechaExpiracion) {
        usuarioEncontrado.fechaExpiracion = fechaExpiracion;
        shouldPersist = true;
    }

    if (shouldPersist) {
        writeDb(db);
    }

    if (usuarioEncontrado.estado === 'pendiente') {
        throw new Error('Tu acceso está pendiente de aprobación por un administrador.');
    }

    if (usuarioEncontrado.estado === 'vencido') {
        throw new Error('Tu acceso se encuentra vencido. Contacta al administrador.');
    }

    return {
        ...buildUserPublicData(usuarioEncontrado),
    };
};

module.exports = {
    login,
    register,
    listRegistrationSedes,
};