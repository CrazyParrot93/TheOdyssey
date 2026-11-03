// localStorage wrapper. Every access is guarded: the game must run with storage blocked.
const GAME_KEY = 'nostos.save.v1';
const SETTINGS_KEY = 'nostos.settings.v1';

function read(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

export const Save = {
  loadGame: () => read(GAME_KEY),
  saveGame: (data) => write(GAME_KEY, data),
  clearGame() { try { localStorage.removeItem(GAME_KEY); } catch (e) { /* storage unavailable */ } },
  loadSettings: () => read(SETTINGS_KEY),
  saveSettings: (s) => write(SETTINGS_KEY, s),
};
