import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatRebootAlertMessage, isTelegramConfigured } from '../src/telegram.js';
import {
  getTelegramSettings,
  saveTelegramSettings,
} from '../src/telegramSettings.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-telegram-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'telegram.db');

describe('telegram settings', () => {
  it('validates and persists settings', () => {
    const bad = saveTelegramSettings({
      enabled: true,
      botToken: '',
      chatId: '',
    });
    assert.equal(bad.ok, false);

    const saved = saveTelegramSettings({
      enabled: true,
      botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
      chatId: '-1001234567890',
    });
    assert.equal(saved.ok, true);
    assert.equal(getTelegramSettings().chatId, '-1001234567890');

    const kept = saveTelegramSettings({
      enabled: true,
      botToken: '',
      chatId: '-1001234567890',
    }, { keepBotTokenIfBlank: true });
    assert.equal(kept.ok, true);
    assert.equal(getTelegramSettings().botToken, '123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
  });

  it('reports configured state', () => {
    assert.equal(
      isTelegramConfigured({
        enabled: true,
        botToken: '123:abc',
        chatId: '99',
      }),
      true,
    );
    assert.equal(
      isTelegramConfigured({
        enabled: false,
        botToken: '123:abc',
        chatId: '99',
      }),
      false,
    );
  });
});

describe('telegram messages', () => {
  it('formats reboot alert text', () => {
    const text = formatRebootAlertMessage({
      sensorLabel: 'ballroomdvote',
      topic: 'ballroomdvote/sensor/uptime_sensor/state',
      previousValue: 89249,
      newValue: 120,
      detectedAtIso: '2026-06-12T12:00:00.000Z',
    });
    assert.match(text, /Device reboot detected/);
    assert.match(text, /ballroomdvote/);
    assert.match(text, /89249 → 120/);
  });
});
