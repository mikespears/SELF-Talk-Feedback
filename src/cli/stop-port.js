import { execSync } from 'node:child_process';

const port = Number(process.argv[2] || 3847);

try {
  const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
  const pids = new Set();
  for (const line of output.split('\n')) {
    if (!line.includes('LISTENING')) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts.at(-1));
    if (pid) pids.add(pid);
  }

  if (!pids.size) {
    console.log(`No listener on port ${port}`);
    process.exit(0);
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'inherit' });
      console.log(`Stopped PID ${pid}`);
    } catch {
      console.warn(`Could not stop PID ${pid}`);
    }
  }
} catch {
  console.log(`No listener on port ${port}`);
}
