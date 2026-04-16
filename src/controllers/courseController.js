const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');

async function readDb() {
  const raw = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function writeDb(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2) + '\n', 'utf-8');
}

function normalizeRoles(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw === undefined || raw === null) return [];
  return [String(raw)];
}

function isUserEnrolled(course, userId) {
  const enrolled = Array.isArray(course?.alumnosInscritos) ? course.alumnosInscritos : [];
  return enrolled.map(String).includes(String(userId));
}

const listarCursos = async (req, res) => {
  try {
    const db = await readDb();
    const cursos = Array.isArray(db?.cursos) ? db.cursos : [];

    const roles = normalizeRoles(req.user?.rol);
    const isAdmin = roles.includes('admin');
    const wantAll = String(req.query?.all || '') === '1';

    // Seguridad: usuarios normales SIEMPRE ven solo sus cursos asignados.
    // Admin ve todos solo si solicita explícitamente ?all=1
    const result = isAdmin && wantAll
      ? cursos
      : cursos.filter((c) => isUserEnrolled(c, req.user?.id));

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error al leer cursos:', error);
    return res.status(500).json({ mensaje: 'No se pudieron obtener los cursos' });
  }
};

const obtenerCursoPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const db = await readDb();
    const cursos = Array.isArray(db?.cursos) ? db.cursos : [];

    const curso = cursos.find((item) => String(item.id) === String(id));

    if (!curso) {
      return res.status(404).json({ mensaje: `Curso con id ${id} no encontrado` });
    }

    const roles = normalizeRoles(req.user?.rol);
    const isAdmin = roles.includes('admin');

    // Seguridad: no-admin solo puede ver cursos donde esté asignado.
    if (!isAdmin && !isUserEnrolled(curso, req.user?.id)) {
      return res.status(403).json({ mensaje: 'No autorizado' });
    }

    return res.status(200).json(curso);
  } catch (error) {
    console.error('Error al buscar curso por id:', error);
    return res.status(500).json({ mensaje: 'No se pudo obtener el detalle del curso' });
  }
};

const asignarAlumnos = async (req, res) => {
  try {
    const { id } = req.params;
    const { alumnosInscritos } = req.body || {};

    if (!Array.isArray(alumnosInscritos)) {
      return res.status(400).json({ mensaje: 'alumnosInscritos debe ser un array' });
    }

    const db = await readDb();
    const cursos = Array.isArray(db?.cursos) ? db.cursos : [];
    const usuarios = Array.isArray(db?.usuarios) ? db.usuarios : [];

    const validUserIds = new Set(usuarios.map((u) => String(u?.id)));

    const normalized = Array.from(
      new Set(
        alumnosInscritos
          .map((x) => String(x))
          .filter((userId) => validUserIds.has(String(userId)))
      )
    );

    const idx = cursos.findIndex((c) => String(c.id) === String(id));
    if (idx === -1) {
      return res.status(404).json({ mensaje: `Curso con id ${id} no encontrado` });
    }

    cursos[idx] = {
      ...cursos[idx],
      alumnosInscritos: normalized,
    };

    await writeDb({ ...db, cursos });

    return res.status(200).json({ success: true, curso: cursos[idx] });
  } catch (error) {
    console.error('Error asignando alumnos:', error);
    return res.status(500).json({ mensaje: 'No se pudo asignar usuarios al curso' });
  }
};

const PRACTICA_PRESENCIAL_MESSAGE =
  'Se le ha notificado a tu instructor que has finalizado la parte teórica. Por favor, espera a ser contactado para coordinar tu evaluación práctica presencial';

const ALLOWED_MODULE_TYPES = new Set(['video', 'lectura', 'quiz', 'practica_presencial']);

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

const DEFAULT_COURSE_IMAGE = '/course-images/curso-1-caidas.svg';

function generateUniqueCourseId(existingIds) {
  for (let attempts = 0; attempts < 10; attempts += 1) {
    const candidate = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (!existingIds.has(String(candidate))) return String(candidate);
  }

  // Fallback ultra improbable collision
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

const crearCurso = async (req, res) => {
  try {
    const { titulo, descripcion, imagen } = req.body || {};

    const db = await readDb();
    const cursos = Array.isArray(db?.cursos) ? db.cursos : [];

    const existingIds = new Set(cursos.map((c) => String(c?.id)));
    const id = generateUniqueCourseId(existingIds);

    const nuevo = {
      id,
      titulo: asTrimmedString(titulo) || 'Nueva Capacitación',
      descripcion: asTrimmedString(descripcion) || 'Descripción de la capacitación',
      imagen: asTrimmedString(imagen) || DEFAULT_COURSE_IMAGE,
      progreso: 0,
      modulos: [],
      alumnosInscritos: [],
    };

    cursos.push(nuevo);

    await writeDb({ ...db, cursos });

    return res.status(201).json({ success: true, curso: nuevo });
  } catch (error) {
    console.error('Error creando curso:', error);
    return res.status(500).json({ mensaje: 'No se pudo crear el curso' });
  }
};

function isPlainObject(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function sanitizeLecturaContenido(raw) {
  if (typeof raw === 'string') {
    const instrucciones = raw.trim();
    return { instrucciones: instrucciones || undefined };
  }

  if (isPlainObject(raw)) {
    const archivoNombre = asTrimmedString(raw.archivoNombre);
    const instrucciones = asTrimmedString(raw.instrucciones);
    return {
      archivoNombre: archivoNombre || undefined,
      instrucciones: instrucciones || undefined,
    };
  }

  return { instrucciones: undefined };
}

function sanitizeQuizContenido(raw) {
  if (!Array.isArray(raw)) return [];

  const preguntas = raw
    .filter((q) => q && typeof q === 'object')
    .map((q) => {
      const tipo = String(q.tipo) === 'respuesta_escrita' ? 'respuesta_escrita' : 'seleccion_multiple';
      const pregunta = asTrimmedString(q.pregunta) || '';

      if (tipo === 'respuesta_escrita') {
        return {
          tipo,
          pregunta,
          respuestaModelo: asTrimmedString(q.respuestaModelo) || undefined,
        };
      }

      const opcionesRaw = Array.isArray(q.opciones) ? q.opciones : [];
      const opciones = opcionesRaw
        .filter((o) => o && typeof o === 'object')
        .map((o) => ({
          texto: asTrimmedString(o.texto) || '',
          correcta: Boolean(o.correcta),
        }));

      if (opciones.length > 0 && !opciones.some((o) => o.correcta)) {
        opciones[0].correcta = true;
      }

      return {
        tipo,
        pregunta,
        opciones,
      };
    })
    // Evita guardar preguntas vacías (sin enunciado)
    .filter((q) => typeof q?.pregunta === 'string' && q.pregunta.trim().length > 0);

  return preguntas;
}

function sanitizeModulos(raw, existing = []) {
  if (!Array.isArray(raw)) return undefined;

  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m, index) => {
      const existingModulo = existing[index] && typeof existing[index] === 'object' ? existing[index] : {};

      const tituloModulo =
        asTrimmedString(m.tituloModulo) || asTrimmedString(existingModulo.tituloModulo) || 'Módulo sin título';

      const tipo = ALLOWED_MODULE_TYPES.has(String(m.tipo))
        ? String(m.tipo)
        : ALLOWED_MODULE_TYPES.has(String(existingModulo.tipo))
          ? String(existingModulo.tipo)
          : 'lectura';

      const rawContenido = m.contenido !== undefined ? m.contenido : existingModulo.contenido;

      let contenido;

      if (tipo === 'practica_presencial') {
        contenido = PRACTICA_PRESENCIAL_MESSAGE;
      } else if (tipo === 'video') {
        const src = asTrimmedString(rawContenido) ?? '';
        // Evita esquemas peligrosos (p.ej. javascript:) en iframes.
        contenido = /^https?:\/\//i.test(src) ? src : '';
      } else if (tipo === 'lectura') {
        contenido = sanitizeLecturaContenido(rawContenido);
      } else if (tipo === 'quiz') {
        contenido = sanitizeQuizContenido(rawContenido);
      } else {
        contenido = asTrimmedString(rawContenido) ?? '';
      }

      return {
        ...existingModulo,
        tituloModulo,
        tipo,
        contenido,
      };
    });
}

const actualizarCurso = async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, descripcion, imagen, modulos } = req.body || {};

    if (modulos !== undefined && !Array.isArray(modulos)) {
      return res.status(400).json({ mensaje: 'modulos debe ser un array' });
    }

    const db = await readDb();
    const cursos = Array.isArray(db?.cursos) ? db.cursos : [];

    const idx = cursos.findIndex((c) => String(c.id) === String(id));
    if (idx === -1) {
      return res.status(404).json({ mensaje: `Curso con id ${id} no encontrado` });
    }

    const current = cursos[idx];
    const next = { ...current };

    const t = asTrimmedString(titulo);
    const d = asTrimmedString(descripcion);
    const i = asTrimmedString(imagen);

    if (t !== undefined) next.titulo = t;
    if (d !== undefined) next.descripcion = d;
    if (i !== undefined) next.imagen = i;

    const sanitizedModulos = sanitizeModulos(modulos, Array.isArray(current?.modulos) ? current.modulos : []);

    if (sanitizedModulos !== undefined) {
      const emptyQuizIndex = sanitizedModulos.findIndex(
        (m) => String(m?.tipo) === 'quiz' && Array.isArray(m?.contenido) && m.contenido.length === 0
      );

      if (emptyQuizIndex !== -1) {
        return res.status(400).json({
          mensaje: `El módulo #${emptyQuizIndex + 1} (quiz) debe tener al menos 1 pregunta con enunciado.`,
        });
      }

      next.modulos = sanitizedModulos;
    }

    cursos[idx] = next;

    await writeDb({ ...db, cursos });

    return res.status(200).json({ success: true, curso: next });
  } catch (error) {
    console.error('Error actualizando curso:', error);
    return res.status(500).json({ mensaje: 'No se pudo actualizar el curso' });
  }
};

const eliminarCurso = async (req, res) => {
  try {
    const { id } = req.params;

    const db = await readDb();
    const cursos = Array.isArray(db?.cursos) ? db.cursos : [];

    const idx = cursos.findIndex((c) => String(c.id) === String(id));
    if (idx === -1) {
      return res.status(404).json({ mensaje: `Curso con id ${id} no encontrado` });
    }

    cursos.splice(idx, 1);
    await writeDb({ ...db, cursos });

    return res.status(200).json({ success: true, id: String(id) });
  } catch (error) {
    console.error('Error eliminando curso:', error);
    return res.status(500).json({ mensaje: 'No se pudo eliminar el curso' });
  }
};

module.exports = {
  listarCursos,
  obtenerCursoPorId,
  crearCurso,
  asignarAlumnos,
  actualizarCurso,
  eliminarCurso,
};
