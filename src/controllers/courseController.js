// src/controllers/courseController.js
const db = require('../db');

function normalizeRoles(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw === undefined || raw === null) return [];
  return [String(raw)];
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

const PRACTICA_PRESENCIAL_MESSAGE =
  'Se le ha notificado a tu instructor que has finalizado la parte teorica. ' +
  'Por favor, espera a ser contactado para coordinar tu evaluacion practica presencial';

const ALLOWED_MODULE_TYPES = new Set(['video', 'lectura', 'quiz', 'practica_presencial']);
const DEFAULT_COURSE_IMAGE = '/course-images/curso-1-caidas.svg';

function buildCourseResponse(row, modulos = [], alumnosInscritos = []) {
  return {
    id:               String(row.id),
    titulo:           row.titulo,
    descripcion:      row.descripcion,
    imagen:           row.imagen_url || DEFAULT_COURSE_IMAGE,
    progreso:         row.progreso || 0,
    instructorId:     row.instructor_id ? String(row.instructor_id) : null,
    modulos,
    alumnosInscritos: alumnosInscritos.map(String),
  };
}

async function getModulosByCurso(cursoId) {
  const result = await db.query(
    'SELECT * FROM modulos WHERE curso_id = $1 ORDER BY orden ASC',
    [cursoId]
  );
  return result.rows.map((m) => ({
    id:                  m.id,
    tituloModulo:        m.titulo,
    tipo:                m.tipo,
    contenido:           m.contenido || null,
    materialDescargable: m.material_url || null,
    completado:          false,
  }));
}

async function getAlumnosByCurso(cursoId) {
  const result = await db.query(
    'SELECT usuario_id FROM inscripciones WHERE curso_id = $1',
    [cursoId]
  );
  return result.rows.map((r) => String(r.usuario_id));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sanitizeLecturaContenido(raw) {
  if (typeof raw === 'string') return { instrucciones: raw.trim() || undefined };
  if (isPlainObject(raw)) {
    return {
      archivoNombre: asTrimmedString(raw.archivoNombre) || undefined,
      instrucciones: asTrimmedString(raw.instrucciones) || undefined,
    };
  }
  return { instrucciones: undefined };
}

function sanitizeQuizContenido(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q) => q && typeof q === 'object')
    .map((q) => {
      const tipo     = String(q.tipo) === 'respuesta_escrita' ? 'respuesta_escrita' : 'seleccion_multiple';
      const pregunta = asTrimmedString(q.pregunta) || '';
      if (tipo === 'respuesta_escrita') {
        return { tipo, pregunta, respuestaModelo: asTrimmedString(q.respuestaModelo) || undefined };
      }
      const opciones = (Array.isArray(q.opciones) ? q.opciones : [])
        .filter((o) => o && typeof o === 'object')
        .map((o) => ({ texto: asTrimmedString(o.texto) || '', correcta: Boolean(o.correcta) }));
      if (opciones.length > 0 && !opciones.some((o) => o.correcta)) opciones[0].correcta = true;
      return { tipo, pregunta, opciones };
    })
    .filter((q) => typeof q?.pregunta === 'string' && q.pregunta.trim().length > 0);
}

function sanitizeModulos(raw, existing = []) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m, index) => {
      const ex = existing[index] && typeof existing[index] === 'object' ? existing[index] : {};
      const tituloModulo =
        asTrimmedString(m.tituloModulo) || asTrimmedString(ex.tituloModulo) || 'Modulo sin titulo';
      const tipo = ALLOWED_MODULE_TYPES.has(String(m.tipo)) ? String(m.tipo)
        : ALLOWED_MODULE_TYPES.has(String(ex.tipo)) ? String(ex.tipo) : 'lectura';
      const rawContenido = m.contenido !== undefined ? m.contenido : ex.contenido;
      let contenido;
      if      (tipo === 'practica_presencial') contenido = PRACTICA_PRESENCIAL_MESSAGE;
      else if (tipo === 'video')   { const s = asTrimmedString(rawContenido) ?? ''; contenido = /^https?:\/\//i.test(s) ? s : ''; }
      else if (tipo === 'lectura') contenido = sanitizeLecturaContenido(rawContenido);
      else if (tipo === 'quiz')    contenido = sanitizeQuizContenido(rawContenido);
      else                         contenido = asTrimmedString(rawContenido) ?? '';
      return { ...ex, tituloModulo, tipo, contenido };
    });
}

const listarCursos = async (req, res) => {
  try {
    const roles   = normalizeRoles(req.user?.rol);
    const isAdmin = roles.includes('admin');
    const wantAll = String(req.query?.all || '') === '1';

    let rows;
    if (isAdmin && wantAll) {
      const result = await db.query('SELECT * FROM cursos ORDER BY creado_en DESC');
      rows = result.rows;
    } else {
      const result = await db.query(
        `SELECT c.* FROM cursos c
         INNER JOIN inscripciones i ON i.curso_id = c.id
         WHERE i.usuario_id = $1
         ORDER BY c.creado_en DESC`,
        [req.user?.id]
      );
      rows = result.rows;
    }

    const result2 = await Promise.all(rows.map(async (c) => {
      const modulos = await getModulosByCurso(c.id);
      const alumnos = await getAlumnosByCurso(c.id);
      return buildCourseResponse(c, modulos, alumnos);
    }));

    return res.status(200).json(result2);
  } catch (error) {
    console.error('Error al listar cursos:', error);
    return res.status(500).json({ mensaje: 'No se pudieron obtener los cursos' });
  }
};

const obtenerCursoPorId = async (req, res) => {
  try {
    const { id }  = req.params;
    const roles   = normalizeRoles(req.user?.rol);
    const isAdmin = roles.includes('admin');

    const cursoResult = await db.query('SELECT * FROM cursos WHERE id = $1', [id]);
    if (cursoResult.rows.length === 0)
      return res.status(404).json({ mensaje: `Curso con id ${id} no encontrado` });
    const curso = cursoResult.rows[0];

    if (!isAdmin) {
      const inscResult = await db.query(
        'SELECT id FROM inscripciones WHERE curso_id = $1 AND usuario_id = $2',
        [id, req.user?.id]
      );
      if (inscResult.rows.length === 0)
        return res.status(403).json({ mensaje: 'No autorizado' });
    }

    const modulos = await getModulosByCurso(id);
    const alumnos = await getAlumnosByCurso(id);
    return res.status(200).json(buildCourseResponse(curso, modulos, alumnos));
  } catch (error) {
    console.error('Error al obtener curso:', error);
    return res.status(500).json({ mensaje: 'No se pudo obtener el detalle del curso' });
  }
};

const crearCurso = async (req, res) => {
  try {
    const { titulo, descripcion, imagen } = req.body || {};

    const result = await db.query(
      `INSERT INTO cursos (titulo, descripcion, imagen_url, instructor_id, publicado)
       VALUES ($1,$2,$3,$4,false) RETURNING *`,
      [
        asTrimmedString(titulo)      || 'Nueva Capacitacion',
        asTrimmedString(descripcion) || 'Descripcion de la capacitacion',
        asTrimmedString(imagen)      || DEFAULT_COURSE_IMAGE,
        req.user?.id || null,
      ]
    );

    const nuevo = result.rows[0];
    return res.status(201).json({ success: true, curso: buildCourseResponse(nuevo, [], []) });
  } catch (error) {
    console.error('Error creando curso:', error);
    return res.status(500).json({ mensaje: 'No se pudo crear el curso' });
  }
};

const actualizarCurso = async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, descripcion, imagen, modulos } = req.body || {};

    if (modulos !== undefined && !Array.isArray(modulos))
      return res.status(400).json({ mensaje: 'modulos debe ser un array' });

    const cursoResult = await db.query('SELECT * FROM cursos WHERE id = $1', [id]);
    if (cursoResult.rows.length === 0)
      return res.status(404).json({ mensaje: `Curso con id ${id} no encontrado` });

    const t = asTrimmedString(titulo);
    const d = asTrimmedString(descripcion);
    const i = asTrimmedString(imagen);

    await db.query(
      `UPDATE cursos SET
         titulo      = COALESCE($1, titulo),
         descripcion = COALESCE($2, descripcion),
         imagen_url  = COALESCE($3, imagen_url),
         actualizado_en = NOW()
       WHERE id = $4`,
      [t || null, d || null, i || null, id]
    );

    if (Array.isArray(modulos)) {
      const existingModulos = await getModulosByCurso(id);
      const sanitized = sanitizeModulos(modulos, existingModulos);

      if (sanitized !== undefined) {
        const emptyQuizIndex = sanitized.findIndex(
          (m) => String(m?.tipo) === 'quiz' && Array.isArray(m?.contenido) && m.contenido.length === 0
        );
        if (emptyQuizIndex !== -1)
          return res.status(400).json({ mensaje: `El modulo #${emptyQuizIndex + 1} (quiz) debe tener al menos 1 pregunta.` });

        await db.query('DELETE FROM modulos WHERE curso_id = $1', [id]);
        for (let idx = 0; idx < sanitized.length; idx++) {
          const m = sanitized[idx];
          await db.query(
            'INSERT INTO modulos (curso_id, titulo, tipo, contenido, orden) VALUES ($1,$2,$3,$4,$5)',
            [id, m.tituloModulo, m.tipo, JSON.stringify(m.contenido), idx]
          );
        }
      }
    }

    const modulosActualizados = await getModulosByCurso(id);
    const alumnos             = await getAlumnosByCurso(id);
    const cursoActualizado    = (await db.query('SELECT * FROM cursos WHERE id = $1', [id])).rows[0];

    return res.status(200).json({ success: true, curso: buildCourseResponse(cursoActualizado, modulosActualizados, alumnos) });
  } catch (error) {
    console.error('Error actualizando curso:', error);
    return res.status(500).json({ mensaje: 'No se pudo actualizar el curso' });
  }
};

const eliminarCurso = async (req, res) => {
  try {
    const { id } = req.params;
    const cursoResult = await db.query('SELECT id FROM cursos WHERE id = $1', [id]);
    if (cursoResult.rows.length === 0)
      return res.status(404).json({ mensaje: `Curso con id ${id} no encontrado` });

    await db.query('DELETE FROM cursos WHERE id = $1', [id]);
    return res.status(200).json({ success: true, id: String(id) });
  } catch (error) {
    console.error('Error eliminando curso:', error);
    return res.status(500).json({ mensaje: 'No se pudo eliminar el curso' });
  }
};

const asignarAlumnos = async (req, res) => {
  try {
    const { id } = req.params;
    const { alumnosInscritos } = req.body || {};

    if (!Array.isArray(alumnosInscritos))
      return res.status(400).json({ mensaje: 'alumnosInscritos debe ser un array' });

    const cursoResult = await db.query('SELECT id FROM cursos WHERE id = $1', [id]);
    if (cursoResult.rows.length === 0)
      return res.status(404).json({ mensaje: `Curso con id ${id} no encontrado` });

    let normalized = [];
    if (alumnosInscritos.length > 0) {
      const placeholders = alumnosInscritos.map((_, i) => `$${i + 1}`).join(',');
      const validResult  = await db.query(
        `SELECT id FROM usuarios WHERE id IN (${placeholders})`,
        alumnosInscritos
      );
      const validIds = new Set(validResult.rows.map((u) => String(u.id)));
      normalized = [...new Set(alumnosInscritos.map(String).filter((uid) => validIds.has(uid)))];
    }

    await db.query('DELETE FROM inscripciones WHERE curso_id = $1', [id]);
    for (const userId of normalized) {
      await db.query(
        'INSERT INTO inscripciones (usuario_id, curso_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, id]
      );
    }

    const modulos = await getModulosByCurso(id);
    const alumnos = await getAlumnosByCurso(id);
    const cursoActualizado = (await db.query('SELECT * FROM cursos WHERE id = $1', [id])).rows[0];

    return res.status(200).json({ success: true, curso: buildCourseResponse(cursoActualizado, modulos, alumnos) });
  } catch (error) {
    console.error('Error asignando alumnos:', error);
    return res.status(500).json({ mensaje: 'No se pudo asignar usuarios al curso' });
  }
};

module.exports = { listarCursos, obtenerCursoPorId, crearCurso, asignarAlumnos, actualizarCurso, eliminarCurso };
