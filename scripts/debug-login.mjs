import { Client } from 'ssh2';
import { getSshConnectOptions, REMOTE_DIR } from './lib/ssh.mjs';

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', (d) => { out += d; process.stdout.write(d); });
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', (code) => (code ? reject(new Error(out)) : resolve(out)));
    });
  });
}

const conn = new Client();
conn.on('ready', async () => {
  await exec(conn, `cd ${REMOTE_DIR} && echo '=== .env ===' && grep -E '^(NODE_ENV|COOKIE_SECURE|SESSION|STAFF_|BIND)' .env && echo '=== service ===' && systemctl is-active self-talk-feedback && ps aux | grep '[n]ode src/index' && echo '=== db perms ===' && ls -la data/ 2>/dev/null || ls -la *.db 2>/dev/null && echo '=== auth test ===' && node - <<'NODE'
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { getDb } from './src/db.js';
dotenv.config();
const db = getDb();
const users = db.prepare('SELECT id, username FROM staff_users').all();
console.log('users:', users);
const row = db.prepare('SELECT password_hash FROM staff_users WHERE username = ?').get('staff');
const pw = process.env.STAFF_PASSWORD;
console.log('env STAFF_PASSWORD set:', Boolean(pw), 'len:', pw?.length ?? 0);
if (row && pw) console.log('env matches db:', bcrypt.compareSync(pw, row.password_hash));
NODE
echo '=== recent logs ==='
journalctl -u self-talk-feedback -n 30 --no-pager
`);
  conn.end();
}).connect(getSshConnectOptions());
