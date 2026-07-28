const { Pool } = require('pg');

// Railway inyecta DATABASE_URL cuando agregás el plugin de PostgreSQL.
// Con la URL interna (postgres.railway.internal) NO se usa SSL.
// Si usaras una URL pública, seteá la variable DB_SSL=true.
if (!process.env.DATABASE_URL) {
  console.error('⚠️  DATABASE_URL no está definida. En Railway: conectá el PostgreSQL al servicio de la app (Variables → DATABASE_URL = ${{Postgres.DATABASE_URL}}) y redesplegá.');
}

const useSSL = process.env.DB_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 5,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

module.exports = pool;
