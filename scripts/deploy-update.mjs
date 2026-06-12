/**
 * Incremental remote deploy: upload app files, npm install, restart service.
 * Preserves remote .env and data/ (does not wipe the install directory).
 * Usage: node scripts/deploy-update.mjs
 */
import { Client } from 'ssh2';
import { createReadStream, readdirSync, statSync } from 'fs';
import { join, relative, posix } from 'path';
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
  'deploy-credentials.local.txt',
]);

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

async function main() {
  const sshOptions = getSshConnectOptions();
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject).connect(sshOptions);
  });

  console.log(`Connected to ${sshOptions.host}\n`);
  console.log(`Project root: ${projectRoot}\n`);

  const files = walk(projectRoot);
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  console.log('=== Upload files ===');
  for (const f of files) {
    await sftpEnsureDir(sftp, posix.dirname(f.remote));
    await sftpUpload(sftp, f.local, f.remote);
    process.stdout.write(`uploaded ${f.remote}\n`);
  }

  await sftpUpload(
    sftp,
    join(projectRoot, 'deploy/self-talk-feedback.service'),
    '/etc/systemd/system/self-talk-feedback.service',
  );
  console.log('uploaded /etc/systemd/system/self-talk-feedback.service');

  console.log('\n=== Install dependencies & restart ===');
  await exec(
    conn,
    `set -e
cd ${REMOTE_DIR}
npm install --omit=dev
chown -R self-talk-feedback:self-talk-feedback ${REMOTE_DIR}
systemctl daemon-reload
systemctl restart self-talk-feedback
sleep 2
systemctl is-active self-talk-feedback
curl -sf http://127.0.0.1:${PORT}/health
`,
  );

  conn.end();
  console.log('\n=== Update complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
