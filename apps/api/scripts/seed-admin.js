import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 12) {
  throw new Error(
    "Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters",
  );
}

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users(email, full_name, password_hash, role)
     VALUES ($1, 'Administrator', $2, 'ADMIN')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'ADMIN', active = true
     RETURNING id, email, role`,
    [email, passwordHash],
  );
  console.log(`Admin account ready: ${rows[0].email}`);
} finally {
  await pool.end();
}
