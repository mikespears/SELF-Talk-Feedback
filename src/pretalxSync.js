import { syncScheduleFromPretalx } from './pretalx.js';
import { getPretalxSettings } from './pretalxSettings.js';

let timer;

async function runSync() {
  try {
    await syncScheduleFromPretalx();
    console.log('Scheduled Pretalx sync completed');
  } catch (err) {
    console.warn(`Scheduled Pretalx sync failed: ${err.message}`);
  }
}

export function reschedulePretalxSync() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  const intervalMs = getPretalxSettings().scheduleSyncIntervalMs;
  timer = setInterval(runSync, intervalMs);
  timer.unref();
}

export function startScheduledPretalxSync() {
  reschedulePretalxSync();
}
