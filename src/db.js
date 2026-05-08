// src/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

pool.connect()
  .then((client) => {
    console.log('✅ Conectado a PostgreSQL');
    client.release();
  })
  .catch((err) => console.error('❌ Error conectando a PostgreSQL:', err.message));

module.exports = pool;
