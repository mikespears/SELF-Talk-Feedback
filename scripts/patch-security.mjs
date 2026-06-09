/**
 * Upload security-hardened app files to the production VM.
 * Requires scripts/deploy.env (see deploy.env.example).
 */
import { Client } from 'ssh2';
import { createReadStream, readdirSync, statSync } from 'fs';
import { join, relative, posix, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSshConnectOptions, REMOTE_DIR } from './lib/ssh.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const UPLOAD = [
  'package.json',
  'package-lock.json',
  'src',
  'public',
  'deploy/self-talk-feedback.service',
];

function collectFiles(relPath) {
  const full = join(projectRoot, relPath);
  const st = statSync(full);
  if (st.isFile()) {
    return [{ local: full, remote: `${REMOTE_DIR}/${relPath.replace(/\\/g, '/')}` }];
  }
  const out = [];
  for (const name of readdirSync(full)) {
    if (name === 'node_modules') continue;
    out.push(...collectFiles(join(relPath, name)));
  }
  return out;
}

function sftpUpload(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    const rs = createReadStream(local);
    const ws = sftp.createWriteStream(remote);
    ws.on('close', resolve);
    ws.on('error', reject);
    rs.on('error', reject);
    rs.pipe(ws);
  });
}

async function sftpEnsureDir(sftp, dir) {
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += `/${p}`;
    await new Promise((resolve, reject) => {
      sftp.mkdir(cur, (err) => {
        if (err && err.code !== 4) reject(err);
        else resolve();
      });
    });
  }
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
  const sftp = await new Promise((r, j) => conn.sftp((e, s) => (e ? j(e) : r(s))));
  const files = UPLOAD.flatMap((p) => collectFiles(p));
  for (const f of files) {
    await sftpEnsureDir(sftp, posix.dirname(f.remote));
    await sftpUpload(sftp, f.local, f.remote);
    console.log('uploaded', f.remote.replace(`${REMOTE_DIR}/`, ''));
  }

  await exec(
    conn,
    `set -e
cd ${REMOTE_DIR}
npm install --omit=dev
id self-talk-feedback >/dev/null 2>&1 || useradd --system --home-dir ${REMOTE_DIR} --shell /sbin/nologin self-talk-feedback
chown -R self-talk-feedback:self-talk-feedback ${REMOTE_DIR}
install -m 644 deploy/self-talk-feedback.service /etc/systemd/system/self-talk-feedback.service
grep -q '^PRETALX_ALLOWED_HOSTS=' .env || echo 'PRETALX_ALLOWED_HOSTS=speakers.southeastlinuxfest.org' >> .env
systemctl daemon-reload
systemctl restart self-talk-feedback
sleep 2
systemctl is-active self-talk-feedback
curl -sf http://127.0.0.1:3847/health
`,
  );
  conn.end();
  console.log('\nSecurity patch deployed.');
}).connect(getSshConnectOptions());
