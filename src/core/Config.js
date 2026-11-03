export const QUALITY_PRESETS = {
  low:    { name: 'Low',    pixelRatio: 0.75, antialias: false, shadows: false, shadowSize: 1024, bloom: false, godRays: false, oceanRings: 110, oceanSegs: 96,  particles: 0.4, grass: 0.2,  trees: 0.6, pointShadows: false },
  medium: { name: 'Medium', pixelRatio: 1,    antialias: false, shadows: true,  shadowSize: 1024, bloom: true,  godRays: true,  oceanRings: 150, oceanSegs: 128, particles: 0.7, grass: 0.45, trees: 0.8, pointShadows: false },
  high:   { name: 'High',   pixelRatio: 1.5,  antialias: true,  shadows: true,  shadowSize: 2048, bloom: true,  godRays: true,  oceanRings: 200, oceanSegs: 180, particles: 1,   grass: 0.75, trees: 1,   pointShadows: true, ao: true, smaa: true },
  ultra:  { name: 'Ultra',  pixelRatio: 2,    antialias: true,  shadows: true,  shadowSize: 4096, bloom: true,  godRays: true,  oceanRings: 260, oceanSegs: 240, particles: 1.3, grass: 1,    trees: 1,   pointShadows: true, ao: true, smaa: true },
};

export function detectQuality() {
  try {
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return 'low';
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/SwiftShader|llvmpipe|Software/i.test(r)) return 'low';
    if (/RTX|GTX 1[06-9]|Radeon RX|RX [5-7]\d{3}|Apple M\d (Pro|Max|Ultra)|Arc A7/i.test(r)) return 'high';
    return 'medium';
  } catch (e) { return 'medium'; }
}

export const DEFAULT_SETTINGS = {
  quality: null,
  masterVol: 0.8, musicVol: 0.7, sfxVol: 0.9, ambVol: 0.8, voiceVol: 0.9,
  subtitles: true, reduceMotion: false, reduceFlashing: false, glare: 1, aimAssist: true, padSensitivity: 1, colorblind: 'none',
  difficulty: 'normal', sensitivity: 1, invertY: false, bindings: null, textSpeed: 1,
};

export const DIFFICULTY = {
  story:  { dmgTaken: 0.45, suspicion: 0.55, parryWindow: 0.32, enemyHp: 0.7 },
  normal: { dmgTaken: 1.0,  suspicion: 1.0,  parryWindow: 0.22, enemyHp: 1.0 },
  hard:   { dmgTaken: 1.5,  suspicion: 1.35, parryWindow: 0.16, enemyHp: 1.3 },
};

export const TUNING = {
  player: {
    runSpeed: 4.8, sprintSpeed: 7.6, crouchSpeed: 2.0, carrySpeed: 2.7, aimSpeed: 2.2, blockSpeed: 1.8,
    accel: 14, decel: 11, turnRate: 14,
    stamina: 100, staminaRegen: 30, staminaDelay: 0.75, sprintCost: 16, dodgeCost: 20, attackCost: 9,
    dodgeTime: 0.56, iframeStart: 0.04, iframeEnd: 0.4, dodgeSpeed: 9.5,
    noise: { crouch: 2.2, run: 8, sprint: 15, scrape: 13, carry: 6 },
  },
  hitStop: { light: 0.055, heavy: 0.11, crit: 0.17, parry: 0.14 },
};
