const authService = require('../services/authService');
const jwt = require('jsonwebtoken'); // Importamos la nueva librería

// Llave secreta para firmar los tokens (configurable por .env)
const SECRET_KEY = process.env.JWT_SECRET || 'dev_insecure_change_me';

const iniciarSesion = (req, res) => {
    const { email, password } = req.body;

    try {
        const datosUsuario = authService.login(email, password);
        
        // 1. Creamos el payload (lo que irá dentro del token)
        const payload = {
            id: datosUsuario.id,
            rol: datosUsuario.rol
        };

        // 2. Firmamos el token (le damos 2 horas de validez)
        const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '2h' });
        
        // 3. Enviamos el mensaje, los datos y EL TOKEN al frontend
        res.status(200).json({
            mensaje: 'Login exitoso',
            usuario: datosUsuario,
            token: token // ¡Aquí va el pase VIP!
        });

    } catch (error) {
        res.status(401).json({ mensaje: error.message });
    }
};

const registrarUsuario = (req, res) => {
    try {
        const datos = authService.register(req.body || {});

        return res.status(201).json({
            mensaje: 'Registro enviado correctamente. Queda pendiente de aprobación.',
            usuario: datos,
        });
    } catch (error) {
        return res.status(400).json({ mensaje: error.message || 'No se pudo completar el registro' });
    }
};

const listarSedesRegistro = (req, res) => {
    try {
        const sedes = authService.listRegistrationSedes();
        return res.status(200).json({ sedes });
    } catch (error) {
        return res.status(500).json({ mensaje: 'No se pudieron obtener las sedes' });
    }
};

module.exports = {
    iniciarSesion,
    registrarUsuario,
    listarSedesRegistro,
};