// Shared service locator. Filled in by main.js at boot.
export const G = {
  bus: null, engine: null, renderer: null, camera: null, rig: null,
  input: null, audio: null, music: null, ui: null, post: null, fx: null,
  state: null, settings: null, quality: null, qualityName: 'medium',
  debug: { god: false, perception: false, overlay: false },
};
