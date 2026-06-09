import mqtt from 'mqtt';
import { normalizeVotePayload, roomKeyFromTopic } from './config.js';
import { getMqttSettings } from './mqttSettings.js';
import { recordVote } from './voteService.js';

let client;
let activeSettings = null;
let status = {
  connected: false,
  lastError: null,
  lastMessageAt: null,
  messagesReceived: 0,
};

const listeners = new Set();

export function onVoteRecorded(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function emitVote(event) {
  for (const handler of listeners) {
    handler(event);
  }
}

function buildConnectOptions(settings) {
  const options = {
    reconnectPeriod: settings.reconnectMs,
    connectTimeout: 30_000,
  };

  if (settings.username || settings.password) {
    options.username = settings.username;
    options.password = settings.password ?? '';
  }

  return options;
}

function attachClientHandlers(settings) {
  client.on('connect', () => {
    status.connected = true;
    status.lastError = null;
    const topic = `${settings.topicPrefix}+`;
    client.subscribe(topic, (err) => {
      if (err) {
        status.lastError = err.message;
      }
    });
  });

  client.on('reconnect', () => {
    status.connected = false;
  });

  client.on('error', (err) => {
    status.lastError = err.message;
  });

  client.on('close', () => {
    status.connected = false;
  });

  client.on('message', (topic, payloadBuffer) => {
    status.lastMessageAt = new Date().toISOString();
    status.messagesReceived += 1;

    const prefix = activeSettings?.topicPrefix ?? settings.topicPrefix;
    const roomKey = roomKeyFromTopic(topic, prefix);
    const rawPayload = payloadBuffer.toString('utf8');
    const voteType = normalizeVotePayload(rawPayload);
    const receivedAtIso = new Date().toISOString();

    if (!roomKey) {
      emitVote({ type: 'ignored', reason: 'unknown_topic', topic, rawPayload });
      return;
    }

    if (!voteType) {
      emitVote({ type: 'ignored', reason: 'invalid_payload', topic, roomKey, rawPayload });
      return;
    }

    const result = recordVote({
      roomKey,
      mqttTopic: topic,
      voteType,
      rawPayload,
      receivedAtIso,
    });

    emitVote({
      type: 'vote',
      topic,
      roomKey,
      voteType,
      matched: result.matched,
      slot: result.slot,
      voteId: result.voteId,
    });
  });
}

export function getMqttStatus() {
  const settings = activeSettings ?? getMqttSettings();
  return {
    ...status,
    url: settings.url,
    topicPrefix: settings.topicPrefix,
    username: settings.username,
    reconnectMs: settings.reconnectMs,
    hasPassword: Boolean(settings.password),
  };
}

export function startMqttListener(settings = getMqttSettings()) {
  if (client) {
    return client;
  }

  activeSettings = settings;
  client = mqtt.connect(settings.url, buildConnectOptions(settings));
  attachClientHandlers(settings);
  return client;
}

export function stopMqttListener() {
  if (client) {
    client.end(true);
    client = null;
    activeSettings = null;
    status.connected = false;
  }
}

export function restartMqttListener(settings = getMqttSettings()) {
  stopMqttListener();
  status.lastError = null;
  return startMqttListener(settings);
}
