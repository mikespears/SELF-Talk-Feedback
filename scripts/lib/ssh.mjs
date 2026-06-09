import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(scriptsDir, '..', 'deploy.env') });

export const REMOTE_DIR = process.env.DEPLOY_REMOTE_DIR || '/opt/self-talk-feedback';

export function getSshConnectOptions() {
  const host = process.env.DEPLOY_HOST;
  if (!host) {
    throw new Error('Set DEPLOY_HOST (e.g. 10.20.93.187) to run deploy scripts.');
  }

  const options = {
    host,
    port: Number(process.env.DEPLOY_SSH_PORT || 22),
    username: process.env.DEPLOY_USER || 'root',
    readyTimeout: 30_000,
  };

  const keyPath = process.env.DEPLOY_SSH_KEY_PATH;
  if (keyPath) {
    options.privateKey = readFileSync(keyPath);
    if (process.env.DEPLOY_SSH_KEY_PASSPHRASE) {
      options.passphrase = process.env.DEPLOY_SSH_KEY_PASSPHRASE;
    }
    return options;
  }

  const password = process.env.DEPLOY_SSH_PASSWORD;
  if (!password) {
    throw new Error('Set DEPLOY_SSH_PASSWORD or DEPLOY_SSH_KEY_PATH for deploy scripts.');
  }
  options.password = password;
  return options;
}
