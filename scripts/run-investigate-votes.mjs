import { Client } from 'ssh2';
import { createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSshConnectOptions } from './lib/ssh.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const local = join(root, 'investigate-votes.mjs');
const remote = '/opt/self-talk-feedback/scripts/investigate-votes.mjs';
const date = process.argv[2] || '06/12/2026';

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', (d) => { out += d; process.stdout.write(d); });
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', (code) => (code ? reject(new Error(`exit ${code}`)) : resolve(out)));
    });
  });
}

const conn = new Client();
conn.on('ready', async () => {
  try {
    await exec(conn, 'mkdir -p /opt/self-talk-feedback/scripts');
    const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
    await new Promise((res, rej) => {
      const ws = sftp.createWriteStream(remote);
      createReadStream(local).pipe(ws);
      ws.on('close', res);
      ws.on('error', rej);
    });
    await exec(conn, `cd /opt/self-talk-feedback && node scripts/investigate-votes.mjs "${date}"`);
  } finally {
    conn.end();
  }
});
conn.connect(getSshConnectOptions());
