const express = require('express');
const router = express.Router();

const usersController = require('../controllers/usersController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

router.get('/', requireAuth, requireAdmin, usersController.listarUsuarios);
router.put('/:id', requireAuth, requireAdmin, usersController.actualizarUsuario);

module.exports = router;
