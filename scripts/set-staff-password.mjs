import { Client } from 'ssh2';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSshConnectOptions, REMOTE_DIR } from './lib/ssh.mjs';

const STAFF_PW = process.argv[2];
if (!STAFF_PW) {
  console.error('Usage: node set-staff-password.mjs <password>');
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', (code) => (code ? reject(new Error(`exit ${code}`)) : resolve()));
    });
  });
}

const conn = new Client();
conn.on('ready', async () => {
  await exec(
    conn,
    `cd ${REMOTE_DIR} && node src/cli/seed-staff.js staff '${STAFF_PW.replace(/'/g, "'\\''")}' && sed -i 's/^STAFF_PASSWORD=.*/STAFF_PASSWORD=${STAFF_PW.replace(/\//g, '\\/')}/' .env && node - <<'NODE'
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { getDb } from './src/db.js';
dotenv.config();
const row = getDb().prepare('SELECT password_hash FROM staff_users WHERE username = ?').get('staff');
console.log('password matches db:', bcrypt.compareSync(process.env.STAFF_PASSWORD, row.password_hash));
NODE`,
  );

  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  writeFileSync(
    join(projectRoot, 'deploy-credentials.local.txt'),
    `Staff username: staff\nStaff password: ${STAFF_PW}\n`,
  );
  console.log(`\nSet staff / ${STAFF_PW}`);
  conn.end();
}).connect(getSshConnectOptions());
