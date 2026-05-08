const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Importamos la ruta de autenticación
const authRoutes = require('./src/routes/authRoutes');
const courseRoutes = require('./src/routes/courseRoutes');
const usersRoutes = require('./src/routes/usersRoutes');
const userRoutes = require('./src/routes/userRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/test-auth', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  const jwt = require('jsonwebtoken');
  const SECRET_KEY = process.env.JWT_SECRET || 'dev_insecure_change_me';
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    res.json({ ok: true, decoded });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : true;

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// Archivos estáticos (imágenes de cursos, etc.)
app.use('/static', express.static(path.join(__dirname, 'public')));

// Fallback explícito para imágenes de cursos (evita edge-cases del static middleware)
app.get('/static/course-images/:name', (req, res) => {
  const { name } = req.params;
  return res.sendFile(path.join(__dirname, 'public', 'course-images', name));
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('¡Servidor de Alumco funcionando correctamente!');
});

// Conectamos la ruta de auth
app.use('/api/auth', authRoutes);

// Conectamos rutas de cursos (fuente de verdad: data/db.json)
app.use('/api/cursos', courseRoutes);

// Usuarios (admin-only)
app.use('/api/usuarios', usersRoutes);

// Perfil de usuario (auth-required)
app.use('/api/user', userRoutes);

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});