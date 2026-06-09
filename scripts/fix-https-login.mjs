import { Client } from 'ssh2';
import { createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { getSshConnectOptions, REMOTE_DIR } from './lib/ssh.mjs';

const NEW_PW = randomBytes(12).toString('base64url');
const files = [
  'src/config.js',
  'src/index.js',
  'src/routes/authRoutes.js',
  'src/security.js',
];

function sftpUpload(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    const rs = createReadStream(local);
    const ws = sftp.createWriteStream(remote);
    ws.on('close', resolve);
    ws.on('error', reject);
    rs.pipe(ws);
  });
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const conn = new Client();
conn.on('ready', async () => {
  const sftp = await new Promise((r, j) => conn.sftp((e, s) => (e ? j(e) : r(s))));
  for (const rel of files) {
    await sftpUpload(sftp, join(root, rel), `${REMOTE_DIR}/${rel.replace(/\\/g, '/')}`);
    console.log('uploaded', rel);
  }

  await exec(
    conn,
    `cd ${REMOTE_DIR}
sed -i '/^COOKIE_SECURE=/d' .env
node src/cli/seed-staff.js staff '${NEW_PW}'
sed -i 's/^STAFF_PASSWORD=.*/STAFF_PASSWORD=${NEW_PW}/' .env
systemctl restart self-talk-feedback
sleep 2
systemctl is-active self-talk-feedback
curl -sf http://127.0.0.1:3847/health
`,
  );

  console.log(`\nStaff login: staff / ${NEW_PW}`);
  conn.end();
}).connect(getSshConnectOptions());
