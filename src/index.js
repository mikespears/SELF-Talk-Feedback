import express from 'express';
import session from 'express-session';
import { config } from './config.js';
import { ensureStaffUser } from './auth.js';
import { getDb, getMeta } from './db.js';
import { startMqttListener } from './mqttClient.js';
import { seedMqttSettingsFromEnvIfMissing } from './mqttSettings.js';
import { seedPretalxSettingsFromEnvIfMissing } from './pretalxSettings.js';
import { startScheduledPretalxSync } from './pretalxSync.js';
import { syncScheduleFromPretalx, getScheduleStats } from './pretalx.js';
import authRoutes from './routes/authRoutes.js';
import staffRoutes from './routes/staffRoutes.js';
import publicRoutes from './routes/publicRoutes.js';

const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: 'self_feedback_sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    },
  }),
);
app.use(express.static(config.publicDir));

app.get('/', (req, res) => {
  if (req.session?.staffUser) {
    res.redirect('/staff');
    return;
  }
  res.redirect('/login');
});

app.get('/health', (req, res) => {
  const schedule = getScheduleStats();
  res.json({
    ok: true,
    version: '1.3.0-pretalx-ui',
    scheduleSlots: schedule.slotCount,
    lastScheduleSync: getMeta('last_schedule_sync'),
  });
});

app.use(authRoutes);
app.use('/staff', staffRoutes);
app.use('/report', publicRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Internal server error');
});

async function bootstrap() {
  getDb();
  const created = ensureStaffUser();
  if (created) {
    console.log(`Created default staff user "${config.staffUsername}"`);
  }

  seedPretalxSettingsFromEnvIfMissing();
  seedMqttSettingsFromEnvIfMissing();
  startMqttListener();

  if (getScheduleStats().slotCount === 0) {
    console.log('No schedule cached; syncing from Pretalx...');
    try {
      const result = await syncScheduleFromPretalx();
      console.log(`Synced ${result.slotCount} schedule slots from Pretalx`);
    } catch (err) {
      console.warn(`Initial Pretalx sync failed: ${err.message}`);
    }
  }

  startScheduledPretalxSync();

  app.listen(config.port, () => {
    console.log(`SELF Talk Feedback listening on http://localhost:${config.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
