import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { config } from '../config.js';

dotenv.config();

const username = process.argv[2] || config.staffUsername;
const password = process.argv[3] || config.staffPassword;

const db = getDb();
const hash = bcrypt.hashSync(password, 12);

db.prepare(
  `INSERT INTO staff_users (username, password_hash) VALUES (?, ?)
   ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`,
).run(username, hash);

console.log(`Staff user "${username}" ready.`);
