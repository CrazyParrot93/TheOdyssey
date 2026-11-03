// Live combat tuning. Every value here is exposed in the F6 panel, persisted, and saved/loaded as presets.
const KEY = 'nostos.tuning.v1';

export const DEFAULT_COMBAT = {
  // Responsiveness
  inputBuffer: 0.18,            // s: attacks, dodge and parry presses are buffered this long
  // Parry / block
  parryStory: 0.2, parryNormal: 0.15, parryHard: 0.11,   // perfect-parry window by difficulty (s)
  partialWindow: 0.16,          // s after the perfect window: partial parry (reduced damage)
  partialDamage: 0.35,          // fraction of damage taken on a partial parry
  blockDamage: 0.12,            // chip damage while blocking normally
  blockStaminaMul: 1.6,         // stamina cost per point of blocked damage
  parryMissRecovery: 0.28,      // s locked out of blocking after a whiffed parry tap
  parryHitStop: 0.1, parryZoom: 6,
  riposteWindow: 1.4,
  // Hit-stop (s) and trauma shake (0..1)
  hitStopLight: 0.05, hitStopHeavy: 0.105, hitStopCrit: 0.17, hitStopTaken: 0.08,
  shakeLight: 0.2, shakeHeavy: 0.4, shakeCrit: 0.6, shakeTaken: 0.45,
  // Weight
  knockLight: 3, knockHeavy: 6.5, slowmoCrit: 0.35,
  // Gamepad
  padDeadzone: 0.15, padCurve: 1.6, padLook: 950, aimAssist: 0.35,
  lowHealth: 0.35,
};
// Dual-motor rumble profiles: [strong, weak, ms]
export const RUMBLE = {
  light: [0.15, 0.6, 90], heavy: [0.7, 0.3, 220], crit: [1, 0.6, 260], parry: [0.9, 0.5, 160],
  hurt: [0.6, 0.9, 200], block: [0.35, 0.5, 110], giantStep: [1, 0.1, 260], boulder: [0.8, 0.5, 220],
};

function load(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

export const COMBAT = { ...DEFAULT_COMBAT, ...(load(KEY) || {}) };
export const Tuning = {
  persist() { save(KEY, COMBAT); },
  reset() { Object.assign(COMBAT, DEFAULT_COMBAT); save(KEY, COMBAT); },
  saveSlot(n) { save(`${KEY}.slot${n}`, COMBAT); },
  loadSlot(n) { const v = load(`${KEY}.slot${n}`); if (v) { Object.assign(COMBAT, DEFAULT_COMBAT, v); save(KEY, COMBAT); } return !!v; },
  export() { return JSON.stringify(COMBAT, null, 1); },
  import(json) { const v = JSON.parse(json); Object.assign(COMBAT, DEFAULT_COMBAT, v); save(KEY, COMBAT); },
  parryWindow(difficulty) { return difficulty === 'story' ? COMBAT.parryStory : difficulty === 'hard' ? COMBAT.parryHard : COMBAT.parryNormal; },
};

// Ranges for the panel sliders: [min, max, step]
export const RANGES = {
  inputBuffer: [0.05, 0.3, 0.01], parryStory: [0.08, 0.35, 0.01], parryNormal: [0.06, 0.3, 0.01], parryHard: [0.04, 0.25, 0.01],
  partialWindow: [0, 0.3, 0.01], partialDamage: [0, 1, 0.05], blockDamage: [0, 0.5, 0.02], blockStaminaMul: [0.5, 3, 0.1],
  parryMissRecovery: [0, 0.6, 0.02], parryHitStop: [0, 0.25, 0.005], parryZoom: [0, 15, 0.5], riposteWindow: [0.3, 3, 0.1],
  hitStopLight: [0, 0.15, 0.005], hitStopHeavy: [0, 0.25, 0.005], hitStopCrit: [0, 0.3, 0.005], hitStopTaken: [0, 0.2, 0.005],
  shakeLight: [0, 1, 0.02], shakeHeavy: [0, 1, 0.02], shakeCrit: [0, 1, 0.02], shakeTaken: [0, 1, 0.02],
  knockLight: [0, 10, 0.25], knockHeavy: [0, 15, 0.25], slowmoCrit: [0.05, 1, 0.05],
  padDeadzone: [0.05, 0.35, 0.01], padCurve: [1, 3, 0.1], padLook: [300, 2000, 25], aimAssist: [0, 1, 0.05], lowHealth: [0, 0.6, 0.05],
};
