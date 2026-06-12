function formatDateTime(isoString) {
  if (!isoString) {
    return '—';
  }
  return new Date(isoString).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function sensorLabel(sensorKey) {
  const parts = String(sensorKey).split('/');
  if (parts.length >= 4 && parts[1] === 'sensor' && parts[2] === 'uptime_sensor') {
    return parts[0];
  }
  if (parts.length > 1 && parts[parts.length - 1] === 'state') {
    return parts[0];
  }
  return parts.length > 1 ? parts[parts.length - 1] : sensorKey;
}

function getCsrfToken() {
  return document.getElementById('live-csrf')?.value || '';
}

function setCsrfToken(token) {
  const input = document.getElementById('live-csrf');
  if (input && token) {
    input.value = token;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAlertBanner(alerts) {
  const banner = document.getElementById('uptime-alert-banner');
  if (!banner) {
    return;
  }

  if (!alerts.length) {
    banner.classList.add('hidden');
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  banner.hidden = false;
  banner.innerHTML = `
    <strong>Device reboot detected</strong>
    <ul id="uptime-alert-list" class="alert-list">
      ${alerts
        .map(
          (event) => `<li data-event-id="${event.id}">
            <span class="alert-text">
              <strong>${escapeHtml(sensorLabel(event.sensor_key))}</strong>
              counter dropped from ${event.previous_value} to ${event.new_value}
              · ${formatDateTime(event.detected_at)}
            </span>
            <button type="button" class="btn btn-small btn-secondary ack-reboot" data-event-id="${event.id}">
              Acknowledge
            </button>
          </li>`,
        )
        .join('')}
    </ul>`;
}

function renderSensorRows(sensors) {
  const tbody = document.getElementById('uptime-sensor-rows');
  if (!tbody) {
    return;
  }

  if (!sensors.length) {
    tbody.innerHTML = '<tr><td colspan="4">No uptime readings yet</td></tr>';
    return;
  }

  tbody.innerHTML = sensors
    .map(
      (sensor) => `<tr>
        <td>${escapeHtml(sensorLabel(sensor.sensor_key))}</td>
        <td><code>${escapeHtml(sensor.mqtt_topic)}</code></td>
        <td>${sensor.last_value}</td>
        <td>${formatDateTime(sensor.last_seen_at)}</td>
      </tr>`,
    )
    .join('');
}

function renderRebootRows(reboots) {
  const tbody = document.getElementById('uptime-reboot-rows');
  if (!tbody) {
    return;
  }

  if (!reboots.length) {
    tbody.innerHTML = '<tr><td colspan="4">No reboots detected</td></tr>';
    return;
  }

  tbody.innerHTML = reboots
    .map(
      (event) => `<tr class="${event.acknowledged_at ? '' : 'warn-row'}">
        <td>${formatDateTime(event.detected_at)}</td>
        <td>${escapeHtml(sensorLabel(event.sensor_key))}</td>
        <td>${event.previous_value} → ${event.new_value}</td>
        <td>${event.acknowledged_at ? 'Acknowledged' : '<strong class="warn">New</strong>'}</td>
      </tr>`,
    )
    .join('');
}

async function acknowledgeReboot(eventId) {
  const csrf = getCsrfToken();
  if (!csrf) {
    return false;
  }
  const body = new URLSearchParams({ eventId: String(eventId), _csrf: csrf });
  const response = await fetch('/staff/uptime/acknowledge', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-csrf-token': csrf,
    },
    body,
  });
  if (!response.ok) {
    return false;
  }
  const result = await response.json();
  return result.ok;
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('.ack-reboot');
  if (!button) {
    return;
  }
  const eventId = Number(button.dataset.eventId);
  if (!eventId) {
    return;
  }
  button.disabled = true;
  const ok = await acknowledgeReboot(eventId);
  if (ok) {
    await refreshLive();
  } else {
    button.disabled = false;
  }
});

async function refreshLive() {
  try {
    const response = await fetch('/staff/api/live', { credentials: 'same-origin' });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data.csrfToken) {
      setCsrfToken(data.csrfToken);
    }
    const alertCount = data.uptime?.unacknowledgedReboots ?? 0;
    document.title = `Live (${data.mqtt.connected ? 'MQTT ok' : 'MQTT down'}${
      alertCount ? ` · ${alertCount} reboot alert${alertCount === 1 ? '' : 's'}` : ''
    }) · SELF Talk Feedback`;

    if (data.uptime) {
      renderAlertBanner(data.uptime.alerts ?? []);
      renderSensorRows(data.uptime.sensors ?? []);
    }
    if (data.recentReboots) {
      renderRebootRows(data.recentReboots);
    }
  } catch {
    // ignore polling errors
  }
}

setInterval(refreshLive, 5000);
refreshLive();
