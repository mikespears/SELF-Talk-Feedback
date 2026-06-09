/**
 * One-shot remote deploy via SSH (credentials from scripts/deploy.env).
 * Usage: node scripts/deploy-remote.mjs
 */
import { Client } from 'ssh2';
import { createReadStream, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, posix } from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { getSshConnectOptions, REMOTE_DIR } from './lib/ssh.mjs';

const PORT = 3847;

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const SKIP = new Set([
  'node_modules',
  '.git',
  'data',
  '.env',
  'scripts',
]);

if (!statSync(join(projectRoot, 'package.json')).isFile()) {
  throw new Error(`Invalid project root (missing package.json): ${projectRoot}`);
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(base, full).replace(/\\/g, '/');
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, base));
    else out.push({ local: full, remote: `${REMOTE_DIR}/${rel}` });
  }
  return out;
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed (${code}): ${cmd}\n${stderr || stdout}`));
          return;
        }
        resolve(stdout);
      });
      stream.on('data', (d) => {
        stdout += d;
        process.stdout.write(d);
      });
      stream.stderr.on('data', (d) => {
        stderr += d;
        process.stderr.write(d);
      });
    });
  });
}

function sftpMkdir(sftp, dir) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dir, (err) => {
      if (err && err.code !== 4) return reject(err);
      resolve();
    });
  });
}

async function sftpEnsureDir(sftp, dir) {
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += `/${p}`;
    await sftpMkdir(sftp, cur);
  }
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

function sftpWriteText(sftp, remote, text) {
  return new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream(remote);
    ws.on('close', resolve);
    ws.on('error', reject);
    ws.end(text);
  });
}

async function main() {
  const sessionSecret = randomBytes(32).toString('hex');
  const staffPassword = randomBytes(12).toString('base64url');

  const sshOptions = getSshConnectOptions();
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect(sshOptions);
  });

  console.log('Connected.\n');

  console.log(`Project root: ${projectRoot}\n`);

  console.log('=== System prep ===');
  await exec(
    conn,
    `set -e
if ! command -v node >/dev/null 2>&1 || [ "$(node -p "process.versions.node.split('.')[0]")" -lt 20 ]; then
  dnf module reset nodejs -y 2>/dev/null || true
  dnf module enable nodejs:20 -y
  dnf install -y nodejs git
fi
node -v
npm -v
rm -rf ${REMOTE_DIR}
mkdir -p ${REMOTE_DIR}
`,
  );

  console.log('\n=== Upload files ===');
  const files = walk(projectRoot);
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  for (const f of files) {
    const remoteDir = posix.dirname(f.remote);
    await sftpEnsureDir(sftp, remoteDir);
    await sftpUpload(sftp, f.local, f.remote);
    process.stdout.write(`uploaded ${f.remote}\n`);
  }

  const envContent = readFileSync(join(projectRoot, '.env.example'), 'utf8')
    .replace('change-me-to-a-long-random-string', sessionSecret)
    .replace('STAFF_PASSWORD=change-me', `STAFF_PASSWORD=${staffPassword}`)
    .replace('PORT=3847', `PORT=${PORT}`)
    + '\nNODE_ENV=production\n';

  await sftpWriteText(sftp, `${REMOTE_DIR}/.env`, envContent);
  console.log('uploaded .env');

  console.log('\n=== npm install & seed ===');
  await exec(
    conn,
    `set -e
id self-talk-feedback >/dev/null 2>&1 || useradd --system --home-dir ${REMOTE_DIR} --shell /sbin/nologin self-talk-feedback
cd ${REMOTE_DIR}
npm install --omit=dev
npm run seed-staff
chown -R self-talk-feedback:self-talk-feedback ${REMOTE_DIR}
`,
  );

  await sftpUpload(
    sftp,
    join(projectRoot, 'deploy/self-talk-feedback.service'),
    '/etc/systemd/system/self-talk-feedback.service',
  );

  await exec(
    conn,
    `systemctl daemon-reload
systemctl enable self-talk-feedback
systemctl restart self-talk-feedback
sleep 2
systemctl is-active self-talk-feedback
curl -sf http://127.0.0.1:${PORT}/health
`,
  );

  console.log('\n=== Firewall (3847/tcp) ===');
  await exec(
    conn,
    `set -e
if systemctl is-active firewalld >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=${PORT}/tcp || true
  firewall-cmd --reload || true
  firewall-cmd --list-ports || true
else
  echo "firewalld not active; skipping"
fi
`,
  );

  conn.end();

  const host = sshOptions.host;
  const creds = [
    `Deployed: ${new Date().toISOString()}`,
    `Host: http://${host}:${PORT}`,
    `Staff username: staff`,
    `Staff password: ${staffPassword}`,
    `SESSION_SECRET: ${sessionSecret}`,
  ].join('\n');

  console.log('\n=== Deploy complete ===');
  console.log(`URL (via NPM): configure proxy to http://${host}:${PORT}`);
  console.log(`Staff login: staff / ${staffPassword}`);
  console.log('Credentials also saved to deploy-credentials.local.txt');
  writeFileSync(join(projectRoot, 'deploy-credentials.local.txt'), creds + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
