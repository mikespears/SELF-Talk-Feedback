if (window.settingsSection) {
  const target = document.getElementById(window.settingsSection);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
