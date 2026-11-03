import * as THREE from 'three';
import { G } from './context.js';

// Height fog: patch three's fog chunks so every built-in material thickens fog near sea level.
function patchFogChunks() {
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
varying float vFogDepth;
varying float vFogWorldY;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
vFogDepth = - mvPosition.z;
vec4 fogWP = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
fogWP = instanceMatrix * fogWP;
#endif
fogWP = modelMatrix * fogWP;
vFogWorldY = fogWP.y;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor;
varying float vFogDepth;
varying float vFogWorldY;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
#ifdef FOG_EXP2
float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
fogFactor *= mix( 1.0, 0.4, clamp( vFogWorldY / 70.0, 0.0, 1.0 ) );
#else
float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
#endif
gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

// Fixed-timestep loop (60 Hz simulation) with render interpolation, slow motion, hit-stop, auto-pause.
export class Engine {
  constructor(canvas, quality) {
    patchFogChunks();
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = quality.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    r.setSize(innerWidth, innerHeight, false);
    this.renderer = r;
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 6000);

    this.scene = null;
    this.fixed = 1 / 60;
    this.acc = 0;
    this.timeScale = 1;
    this.slowTarget = 1;
    this.slowSpeed = 6;
    this.hitStopT = 0;
    this.gameTime = 0;
    this.realTime = 0;
    this.paused = false;
    this.frame = 0;
    this.fps = 60;
    this.frameMs = 16;

    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) G.bus.emit('appBlur'); });
    addEventListener('blur', () => G.bus.emit('appBlur'));
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.ui?.toast('Graphics context lost — try a lower quality preset.', 'warn'); });
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    G.post?.resize(w, h);
  }

  setPixelRatio(pr) { this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pr)); this.resize(); }

  setScene(s) {
    if (this.scene && this.scene.exit) this.scene.exit();
    this.scene = s;
    this.acc = 0;
    this.slowTarget = this.timeScale = 1;
    this.hitStopT = 0;
    if (s.enter) s.enter();
    G.post.setScene(s.threeScene);
  }

  hitStop(seconds) { if (seconds > this.hitStopT) this.hitStopT = seconds; }
  setTimeScale(v, speed = 6) { this.slowTarget = v; this.slowSpeed = speed; }

  start() {
    this.last = performance.now();
    requestAnimationFrame(this._loop);
  }

  _loop = (now) => {
    requestAnimationFrame(this._loop);
    const realDt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.realTime += realDt;
    this.frame++;
    this.frameMs = this.frameMs * 0.9 + realDt * 1000 * 0.1;
    this.fps = 1000 / this.frameMs;

    G.input.poll(realDt);
    this.timeScale += (this.slowTarget - this.timeScale) * Math.min(1, realDt * this.slowSpeed);

    let dt = 0;
    if (!this.paused) {
      if (this.hitStopT > 0) this.hitStopT -= realDt;
      else dt = realDt * this.timeScale;
    }
    this.gameTime += dt;

    const s = this.scene;
    try {
      if (s) {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= this.fixed && steps < 5) {
          if (s.fixedUpdate) s.fixedUpdate(this.fixed);
          this.acc -= this.fixed;
          steps++;
        }
        if (steps >= 5) this.acc = 0;
        if (s.update) s.update(dt, realDt, this.acc / this.fixed);
      }
    } catch (e) {
      console.error(e);
      if (!this._errShown) { this._errShown = true; G.ui?.toast('An error occurred — see console (F12).', 'warn'); }
    }
    G.audio?.update(realDt);
    G.music?.update(realDt);
    G.ui?.update(realDt);
    G.touch?.update();
    G.post.render(realDt, dt);
    G.debugUI?.update(realDt);
  };
}
