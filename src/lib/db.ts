import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_SERVER || '92.112.184.72',
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'Jsdrevolution123',
  database: process.env.DB_NAME || 'CAPTACIONES',
  port: parseInt(process.env.DB_PORT || '1296', 10),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export default pool;
