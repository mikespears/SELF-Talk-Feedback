async function refreshLive() {
  try {
    const response = await fetch('/staff/api/live', { credentials: 'same-origin' });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    document.title = `Live (${data.mqtt.connected ? 'MQTT ok' : 'MQTT down'}) · SELF Talk Feedback`;
  } catch {
    // ignore polling errors
  }
}

setInterval(refreshLive, 5000);
refreshLive();
