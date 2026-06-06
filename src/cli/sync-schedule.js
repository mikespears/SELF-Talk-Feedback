import dotenv from 'dotenv';
import { syncScheduleFromPretalx } from '../pretalx.js';
import { getDb } from '../db.js';

dotenv.config();

async function main() {
  getDb();
  const result = await syncScheduleFromPretalx();
  console.log(`Synced ${result.slotCount} slots at ${result.syncedAt}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
