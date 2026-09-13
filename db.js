const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT, full_name TEXT
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY, contract_no TEXT, contractor_name TEXT,
      total_area NUMERIC, total_value NUMERIC, contractor_line_id TEXT, contractor_email TEXT
    );
    CREATE TABLE IF NOT EXISTS job_orders (
      id SERIAL PRIMARY KEY, job_order_no TEXT, contract_id INTEGER REFERENCES contracts(id),
      issued_date TEXT, delivery_date TEXT, survey_date TEXT, start_date TEXT,
      duration_days INTEGER, completion_date TEXT, prepared_by TEXT, department TEXT,
      issued_for TEXT, map_image TEXT, total_area NUMERIC, work_detail TEXT,
      workers TEXT, equipment TEXT, area_restriction TEXT, safety_condition TEXT,
      waste_management TEXT, access_token TEXT UNIQUE, status TEXT DEFAULT 'issued',
      employer_signature TEXT, employer_name TEXT, employer_signed_at TIMESTAMP,
      contractor_signature TEXT, contractor_name TEXT, contractor_signed_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS job_order_items (
      id SERIAL PRIMARY KEY, job_order_id INTEGER REFERENCES job_orders(id) ON DELETE CASCADE,
      work_type TEXT, prev_cumulative NUMERIC, area_this_order NUMERIC, unit_price NUMERIC
    );
    CREATE TABLE IF NOT EXISTS job_order_photos (
      id SERIAL PRIMARY KEY, job_order_id INTEGER REFERENCES job_orders(id) ON DELETE CASCADE,
      photo_url TEXT, caption TEXT, uploaded_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const admin = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
  if (admin.rows.length === 0) {
    await pool.query(
      'INSERT INTO users (username,password,role,full_name) VALUES ($1,$2,$3,$4)',
      ['admin', bcrypt.hashSync('admin123', 8), 'employer', 'เจ้าหน้าที่ EECO']
    );
    console.log('👤 สร้างผู้ใช้ admin เริ่มต้นแล้ว (username: admin / password: admin123)');
  }
}

module.exports = { pool, initSchema };