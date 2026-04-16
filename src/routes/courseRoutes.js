const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

router.get('/', requireAuth, courseController.listarCursos);
router.get('/:id', requireAuth, courseController.obtenerCursoPorId);

// Admin: crear curso
router.post('/', requireAuth, requireAdmin, courseController.crearCurso);

// Admin: editar curso (título, descripción, imagen, módulos)
router.put('/:id', requireAuth, requireAdmin, courseController.actualizarCurso);

// Admin: eliminar curso
router.delete('/:id', requireAuth, requireAdmin, courseController.eliminarCurso);

// Admin: asignar alumnos a un curso
router.put('/:id/alumnos', requireAuth, requireAdmin, courseController.asignarAlumnos);

module.exports = router;
