# Plataforma de Capacitacion Digital Alumco

LMS (Learning Management System) para la ONG Alumco, orientado a la capacitacion de colaboradores de ELEAM.
El sistema incluye experiencia para usuarios finales, herramientas de administracion avanzadas, autenticacion con JWT y persistencia local en JSON.

---

## Stack Tecnologico

- Frontend: React 18 + Vite + TypeScript + Tailwind + Radix UI
- Backend: Node.js + Express + JWT
- Persistencia: archivo JSON local (backend-alumco/data/db.json)
- Estilos/UI: componentes reutilizables + Lucide icons + Sonner (toasts)

---

## Funcionalidades del Software (Completo)

### 1. Autenticacion y Control de Acceso

- Login con JWT (token Bearer, expiracion 2 horas).
- Registro real contra backend (no mock local).
- Restauracion de sesion desde localStorage con control de version de esquema de auth.
- Redireccion por rol tras login:
  - admin -> dashboard admin
  - usuario/profesor -> panel de aprendizaje
- Bloqueo de acceso por estado de cuenta:
  - pendiente: no puede ingresar hasta aprobacion admin
  - vencido: acceso denegado
- Verificacion de estado al autenticar y tambien en middleware protegido.

### 2. Registro de Usuario (Sign Up)

- Formulario profesional con campos obligatorios:
  - Nombre completo
  - RUT
  - Genero (femenino, masculino, otro con iconos)
  - Sede
  - Correo
  - Contrasena
  - Confirmar contrasena
- Sedes oficiales habilitadas:
  - Hualpen (Region del Biobio)
  - Coyhaique (Region de Aysen)
- Validaciones en frontend y backend:
  - Contrasenas iguales
  - Correo valido
  - Largo minimo de contrasena
  - RUT valido con digito verificador (modulo 11)
  - Mensaje inline bajo campo RUT cuando es invalido (tras blur o submit)
- RUT con mascara/formato en tiempo real (X.XXX.XXX-X).
- Registro inicial con estado de aprobacion:
  - estado = pendiente
  - rol = usuario
  - cargo = Pendiente de asignacion
  - fechaRegistro y fechaExpiracion inicializadas

### 3. Gestion de RUT (End-to-End)

- Normalizacion para almacenamiento (sin puntos ni guion, DV incluido).
- Formateo para visualizacion (X.XXX.XXX-X).
- Validacion matematica del digito verificador en frontend y backend.
- Busqueda tolerante por RUT en admin (con/sin puntos y guion).

### 4. Experiencia Usuario (Panel y Cursos)

- Panel principal con:
  - resumen de cursos
  - estado de conexion con backend
  - acceso directo a perfil
- Listado de cursos asignados al usuario autenticado.
- Detalle de curso con:
  - imagen hero
  - progreso calculado
  - timeline visual por modulos
  - navegacion de retorno segura (whitelist de rutas internas)
- Tipos de modulo soportados:
  - Video
  - Lectura
  - Quiz
  - Practica presencial (mensaje fijo institucional)

### 5. Perfil de Usuario y Certificados

- Edicion de perfil:
  - nombre completo
  - RUT
  - cargo (solo editable por admin)
  - rol en solo lectura
- Firma para certificados:
  - texto (firma tipografica)
  - imagen PNG/JPG (con limite de tamano)
- Requisito de firma para certificados:
  - sin firma configurada, no se habilita descarga
- Descarga de certificado imprimible/PDF al completar 100%.

### 6. Dashboard de Administracion

- Portal admin con accesos a:
  - Alertas
  - Mi Aprendizaje (admin)
  - Gestion de Capacitaciones
  - Dashboard de Metricas
  - Centro de Usuarios
  - Perfil
- Badge de usuarios pendientes en tarjeta de Centro de Usuarios.

### 7. Centro de Usuarios (Admin Avanzado)

- Vista segmentada por estado:
  - pendientes
  - activos
  - vencidos
- Filtros combinables por:
  - nombre/RUT
  - sede
  - cargo
- Edicion avanzada por modal:
  - RUT
  - sede (select)
  - cargo (select por catalogo de areas ELEAM)
  - estado
  - fecha de expiracion
  - roles multiples (administrador, profesor, usuario)
- Reglas de negocio:
  - al editar un pendiente, pasa automaticamente a activo
  - sedes y cargos validados en backend
  - roles validados y normalizados en backend

### 8. Gestion de Capacitaciones (Admin)

- Listado completo de cursos (modo admin all=1).
- Crear curso nuevo rapidamente.
- Editar curso existente (dialogo y editor pro full-page).
- Eliminar curso.
- Asignacion de alumnos a curso.

### 9. Editor Pro de Cursos

- Edicion completa de metadatos del curso:
  - titulo
  - descripcion
  - imagen
- Gestion de modulos:
  - agregar
  - editar
  - eliminar
  - reordenar (subir/bajar)
- Soporte de quiz estructurado:
  - seleccion multiple
  - respuesta escrita
  - validacion para evitar quiz vacio
- Lectura con contenido e identificador de archivo (simulado por nombre).
- Practica presencial normalizada con mensaje fijo.
- Protecciones UX:
  - alerta por cambios sin guardar al salir
  - alerta beforeunload (recarga/cierre)
- Asignacion masiva a curso por:
  - sede
  - cargo

### 10. Dashboard de Metricas (Admin)

- KPIs globales:
  - inscripciones totales
  - completadas
  - ratio completadas/inscritas
- Progreso promedio por sede.
- Distribucion de usuarios por cargo.
- Exclusiones aplicadas al calculo (por ejemplo usuarios pendientes).

### 11. API Backend y Reglas de Seguridad

- Auth:
  - POST /api/auth/login
  - POST /api/auth/register
  - GET /api/auth/sedes
- Cursos:
  - GET /api/cursos
  - GET /api/cursos/:id
  - POST /api/cursos (admin)
  - PUT /api/cursos/:id (admin)
  - DELETE /api/cursos/:id (admin)
  - PUT /api/cursos/:id/alumnos (admin)
- Usuarios:
  - GET /api/usuarios (admin)
  - PUT /api/usuarios/:id (admin)
- Perfil:
  - GET /api/user/profile
  - PUT /api/user/profile
- Seguridad:
  - middleware requireAuth + requireAdmin
  - verificacion de token JWT
  - control de estados pendiente/vencido
  - saneamiento de datos de curso/perfil

---

## Instalacion y Ejecucion

### 1) Clonar

```bash
git clone <URL_DEL_REPO>
cd alumco_ong
```

### 2) Instalar dependencias

Backend:

```bash
cd backend-alumco
npm install
```

Frontend:

```bash
cd frontend-alumco
npm install
```

### 3) Variables de entorno

Backend:

- Copia backend-alumco/.env.example a backend-alumco/.env
- Valores base:
  - PORT=3000
  - CORS_ORIGIN=http://localhost:5173
  - JWT_SECRET=change_me_in_local_env

Frontend:

- Copia frontend-alumco/.env.example a frontend-alumco/.env
- Valor recomendado:
  - VITE_API_URL=http://localhost:3000

### 4) Ejecutar proyecto

Opcion A (Windows):

```bat
iniciar_proyecto.bat
```

Opcion B (manual en 2 terminales):

Backend:

```bash
cd backend-alumco
npm run dev
```

Frontend:

```bash
cd frontend-alumco
npm run dev
```

URLs por defecto:

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

Nota para PowerShell en Windows:

- Si `npm` falla por ExecutionPolicy, usa `npm.cmd`.

---

## Persistencia y Estructura de Datos

- Fuente de verdad: backend-alumco/data/db.json
- Estructuras principales:
  - usuarios
  - cursos
- Estaticos:
  - backend-alumco/public/alumco-logo.png
  - backend-alumco/public/course-images/

---

## Estructura del Repositorio

- backend-alumco/
  - server.js
  - src/routes/
  - src/controllers/
  - src/services/
  - src/middlewares/
  - src/utils/
  - data/db.json
  - public/

- frontend-alumco/
  - src/app/pages/
  - src/app/components/
  - src/app/services/
  - src/app/contexts/
  - src/app/config/
  - src/app/types/

---

## Consideraciones Operativas

- El proyecto esta optimizado para entorno local y persistencia JSON.
- No versionar .env, node_modules ni dist.
- Para administradores nuevos, el flujo recomendado es:
  - registrar usuario
  - aprobar y asignar rol admin desde Centro de Usuarios
