import { G } from './core/context.js';
import { EventBus } from './core/EventBus.js';
import { QUALITY_PRESETS, DEFAULT_SETTINGS, detectQuality } from './core/Config.js';
import { Save } from './core/Save.js';
import { Input } from './core/Input.js';
import { Engine } from './core/Engine.js';
import { GameState } from './core/State.js';
import { PostFX } from './render/PostFX.js';
import { initAssets } from './assets/Assets.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Music } from './audio/Music.js';
import { UI } from './ui/UI.js';
import { DebugUI } from './ui/Debug.js';
import { TuningPanel } from './ui/TuningPanel.js';
import { CameraRig } from './game/CameraRig.js';
import { Flow } from './game/Flow.js';
import { TitleScene } from './scenes/TitleScene.js';
import { Humanoid } from './assets/Character.js';
import { TouchControls, isTouchDevice } from './ui/TouchControls.js';

const status = (t) => { const e = document.getElementById('boot-status'); if (e) e.textContent = t; };
// Yield a frame for the boot status to paint; fall back to a timer when the tab is hidden (rAF paused).
const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });

function applySettings(key) {
  const s = G.settings;
  if (['masterVol', 'musicVol', 'sfxVol', 'ambVol', 'voiceVol'].includes(key)) G.audio.applyVolumes();
  if (key === 'colorblind') G.post.setColorblind(s.colorblind);
  if (key === 'quality') {
    G.qualityName = s.quality;
    G.quality = QUALITY_PRESETS[s.quality] || QUALITY_PRESETS.medium;
    G.engine.setPixelRatio(G.quality.pixelRatio);
    G.renderer.shadowMap.enabled = G.quality.shadows;
    G.post.applyQuality(G.quality);
    G.engine.scene?.threeScene?.traverse((o) => {
      if (o.isDirectionalLight) o.castShadow = G.quality.shadows;
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
    G.ui.toast(`Quality: ${G.quality.name}. Ocean and foliage density apply on the next scene.`, '');
  }
}

function openPause() {
  const s = G.engine.scene;
  if (!s?.pausable || G.ui.menuOpen || G.ui.inDialogue || G.ui.el.menus.querySelector('.choice-menu')) return;
  G.engine.paused = true;
  G.input.intentionalUnlock = true;
  G.input.unlockPointer();
  G.audio.duck(true);
  G.ui.openPause({
    onResume: () => { G.engine.paused = false; G.audio.duck(false); G.input.lockPointer(); },
    onRestart: () => { G.engine.paused = false; G.audio.duck(false); Flow.restart(); },
    onQuit: () => { G.engine.paused = false; G.audio.duck(false); Flow.toTitle(); },
  });
}

async function boot() {
  G.bus = new EventBus();
  G.settings = { ...DEFAULT_SETTINGS, ...(Save.loadSettings() || {}) };
  if (!G.settings.quality || !QUALITY_PRESETS[G.settings.quality]) { G.settings.quality = detectQuality(); Save.saveSettings(G.settings); }
  G.qualityName = G.settings.quality;
  G.quality = QUALITY_PRESETS[G.qualityName];
  const canvas = document.getElementById('game');
  G.input = new Input(canvas);
  if (isTouchDevice()) G.touch = new TouchControls(G.input);
  G.input.setBindings(G.settings.bindings);
  G.engine = new Engine(canvas, G.quality);
  G.renderer = G.engine.renderer;
  G.camera = G.engine.camera;
  G.post = new PostFX(G.renderer, G.camera, G.quality);
  G.post.resize(innerWidth, innerHeight);
  G.rig = new CameraRig(G.camera);
  G.audio = new AudioEngine();
  G.music = new Music(G.audio);
  G.ui = new UI(document.getElementById('ui'));
  G.debugUI = new DebugUI();
  G.tuningPanel = new TuningPanel();
  G.applySettings = applySettings;
  G.bus.on('speakBlip', (id) => id && Humanoid.speak(id));
  window.NOSTOS = G; // console access for debugging
  status('Shaping bronze, linen, and stone…');
  await nextFrame();
  initAssets();
  const { prebuild } = await import('./assets/Anatomy.js');
  const { ODYSSEUS } = await import('./data/crew.js');
  await prebuild([ODYSSEUS.look], (i, n) => status(`Sculpting Odysseus… ${Math.round((i / n) * 100)}%`));
  status('Raising the sea…');
  await nextFrame();
  G.state = new GameState(Save.loadGame());
  G.engine.setScene(new TitleScene());
  // Shader warm-up so the first frames don't hitch.
  try { G.renderer.compile(G.engine.scene.threeScene, G.camera); } catch (e) { /* compile is best-effort */ }
  G.engine.start();
  status('');
  document.getElementById('boot').classList.add('gone');

  const press = document.createElement('div');
  press.className = 'press-any';
  press.textContent = 'Press any key';
  document.body.appendChild(press);
  const start = () => {
    if (G.started) return;
    G.started = true;
    press.remove();
    G.audio.init();
    G.music.init();
    G.engine.scene?.showMenu?.();
  };
  addEventListener('keydown', start, { once: true });
  addEventListener('mousedown', start, { once: true });
  addEventListener('touchend', start, { once: true });
  G.bus.on('padbutton', start);

  // Pause: Esc/P/Start, losing pointer lock mid-play, or the tab losing focus.
  G.bus.on('keydown', (code) => { if (G.started && G.input.bindings.pause.includes(code)) setTimeout(openPause, 0); });
  G.bus.on('padbutton', (i) => { if (i === 9) setTimeout(openPause, 0); });
  G.bus.on('appBlur', () => openPause());
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return;
    if (G.input.intentionalUnlock) { G.input.intentionalUnlock = false; return; }
    const s = G.engine.scene;
    if (s?.pausable && (s.player ? s.player.control : true) && !G.ui.inDialogue) openPause();
  });
  canvas.addEventListener('click', () => { if (G.engine.scene?.pausable && !G.ui.menuOpen) G.input.lockPointer(); });
  G.bus.on('gamepad', (e) => G.ui.toast(e.connected ? 'Controller connected' : 'Controller disconnected', ''));
}

boot().catch((e) => {
  console.error(e);
  status('The gods frown: ' + (e.message || e) + ' — check the console (F12).');
});
