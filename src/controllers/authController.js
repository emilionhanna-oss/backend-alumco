// src/controllers/authController.js
const authService = require('../services/authService');
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'dev_insecure_change_me';

const iniciarSesion = async (req, res) => {
  const { email, password } = req.body;

  try {
    const datosUsuario = await authService.login(email, password);

    const payload = {
      id:  datosUsuario.id,
      rol: datosUsuario.rol,
    };

    const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '2h' });

    return res.status(200).json({
      mensaje: 'Login exitoso',
      usuario: datosUsuario,
      token,
    });
  } catch (error) {
    return res.status(401).json({ mensaje: error.message });
  }
};

const registrarUsuario = async (req, res) => {
  try {
    const datos = await authService.register(req.body || {});
    return res.status(201).json({
      mensaje: 'Registro enviado correctamente. Queda pendiente de aprobacion.',
      usuario: datos,
    });
  } catch (error) {
    return res.status(400).json({ mensaje: error.message || 'No se pudo completar el registro' });
  }
};

const listarSedesRegistro = async (req, res) => {
  try {
    const sedes = authService.listRegistrationSedes();
    return res.status(200).json({ sedes });
  } catch (error) {
    return res.status(500).json({ mensaje: 'No se pudieron obtener las sedes' });
  }
};

module.exports = { iniciarSesion, registrarUsuario, listarSedesRegistro };
