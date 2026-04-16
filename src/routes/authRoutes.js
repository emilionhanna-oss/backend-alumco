// Archivo: src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Ruta para procesar el login
router.post('/login', authController.iniciarSesion);
router.post('/register', authController.registrarUsuario);
router.get('/sedes', authController.listarSedesRegistro);

module.exports = router;