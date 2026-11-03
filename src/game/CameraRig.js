import * as THREE from 'three';
import { G } from '../core/context.js';
import { clamp, damp, dampAngle, lerp, ease } from '../core/math.js';

// Third-person rig: spring-damped follow, collision, soft lock-on, framing for giants,
// trauma shake, plus spline / static / orbit cinematic modes.
export class CameraRig {
  constructor(cam) {
    this.cam = cam;
    this.mode = 'follow';
    this.yaw = Math.PI; this.pitch = 0.2;
    this.dist = 5.2; this.curDist = 5.2;
    this.fov = 55; this.curFov = 55; this.fovAdd = 0;
    this.shoulder = 0.55; this.curShoulder = 0.55;
    this.height = 1.6;
    this.target = null;           // Vector3 to follow
    this.focus = new THREE.Vector3();
    this.lockTarget = null;       // Vector3 for soft lock
    this.big = null;              // { pos, radius } giant framing
    this.aim = false;
    this.collide = null;          // (from, to) => safe distance
    this.trauma = 0;
    this.t = 0;
    this.minPitch = -0.55; this.maxPitch = 1.15;
    this.shot = null;
    this.staticPos = new THREE.Vector3(); this.staticLook = new THREE.Vector3();
    this.orbit = { center: new THREE.Vector3(), radius: 40, height: 10, speed: 0.05, angle: 0 };
    this._look = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this.smoothStatic = 0;
    this.kickFov = 0; this.punchYaw = 0; this.punchPitch = 0;
    this.avoidSun = false; this.idleLookT = 0; this.backlitT = 0;
    this.drift = 1;
  }

  // Short camera impulses: a zoom kick (FOV) and a directional punch (yaw/pitch), both self-decaying.
  fovKick(deg) { if (!G.settings?.reduceMotion) this.kickFov = deg; }
  punch(yaw, pitch) { const k = G.settings?.reduceMotion ? 0.3 : 1; this.punchYaw += yaw * k; this.punchPitch += pitch * k; }
  addTrauma(v) { this.trauma = Math.min(1, this.trauma + v * (G.settings?.reduceMotion ? 0.3 : 1)); }

  follow(target, { snap = false, yaw } = {}) {
    this.mode = 'follow'; this.target = target; this.shot = null;
    if (yaw !== undefined) this.yaw = yaw;
    if (snap) { this.focus.copy(target).y += this.height; this.curDist = this.dist; }
  }

  toggleFly() {
    if (this.mode === 'fly') { this.mode = this._preFly || 'follow'; G.debug.fly = false; return false; }
    this._preFly = this.mode; this.mode = 'fly'; G.debug.fly = true;
    const d = this.cam.getWorldDirection(_e); this.flyYaw = Math.atan2(d.x, d.z); this.flyPitch = Math.asin(d.y);
    return true;
  }

  setStatic(pos, look, smooth = 0) {
    this.mode = 'static';
    this.staticPos.copy(pos); this.staticLook.copy(look);
    this.smoothStatic = smooth;
    if (!smooth) { this.cam.position.copy(pos); this._look.copy(look); }
  }

  setOrbit(center, radius, height, speed, angle) {
    this.mode = 'orbit';
    Object.assign(this.orbit, { radius, height, speed });
    this.orbit.center.copy(center);
    if (angle !== undefined) this.orbit.angle = angle;
  }

  // Spline shot: positions and look targets as arrays of Vector3. Resolves when finished.
  playShot({ pos, look, duration = 4, ease: e = 'inOutSine', fov }) {
    this.mode = 'shot';
    const pc = pos.length > 1 ? new THREE.CatmullRomCurve3(pos) : null;
    const lc = look.length > 1 ? new THREE.CatmullRomCurve3(look) : null;
    return new Promise((resolve) => {
      this.shot = { pc, lc, p0: pos[0], l0: look[0], dur: duration, t: 0, ease: ease[e] || ease.inOutSine, fov, resolve };
    });
  }

  update(dt, look) {
    this.t += dt;
    const cam = this.cam;
    const sens = 0.0022 * (G.settings?.sensitivity || 1);
    if (this.mode === 'follow' && this.target) {
      if (look) {
        this.yaw -= look.x * sens;
        this.pitch += look.y * sens * (G.settings?.invertY ? -1 : 1);
        if (Math.abs(look.x) + Math.abs(look.y) > 0.5) this.idleLookT = 0;
      }
      this.idleLookT += dt;
      // Backlit for >2s with nobody steering the camera: drift so the sun sits beside the subject.
      const back = G.post?.backlit || 0;
      this.backlitT = back > 0.55 ? this.backlitT + dt : 0;
      if (this.avoidSun && this.backlitT > 2 && this.idleLookT > 2 && !this.lockTarget && !this.aim) {
        const sd = G.post.sunDir, side = Math.sin(this.yaw) * sd.z - Math.cos(this.yaw) * sd.x;
        this.yaw += (side >= 0 ? -1 : 1) * 0.28 * dt * back;
      }
      this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);
      const tgt = _a.copy(this.target); tgt.y += this.height;
      if (this.lockTarget) {
        const dx = this.lockTarget.x - this.target.x, dz = this.lockTarget.z - this.target.z;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
        this.pitch = damp(this.pitch, 0.22, 3, dt);
        tgt.lerp(_b.copy(this.lockTarget).setY(tgt.y), 0.18);
      }
      this.focus.x = damp(this.focus.x, tgt.x, 12, dt);
      this.focus.z = damp(this.focus.z, tgt.z, 12, dt);
      this.focus.y = damp(this.focus.y, tgt.y, 7, dt);

      let dist = this.dist, fov = this.fov, sh = this.shoulder;
      if (this.big) {
        const d = Math.hypot(this.big.pos.x - this.target.x, this.big.pos.z - this.target.z);
        const k = clamp(1 - (d - this.big.radius) / 18);
        dist += 4.5 * k; fov += 10 * k;
        this.pitch = damp(this.pitch, Math.min(this.pitch, 0.05), 1.5 * k, dt);
      }
      if (this.aim) { dist = 2.1; sh = 0.72; fov = 44; }
      this.curShoulder = damp(this.curShoulder, sh, 10, dt);
      const dirX = Math.sin(this.yaw) * Math.cos(this.pitch), dirY = -Math.sin(this.pitch), dirZ = Math.cos(this.yaw) * Math.cos(this.pitch);
      const rightX = -Math.cos(this.yaw), rightZ = Math.sin(this.yaw);
      const pivot = _c.set(this.focus.x + rightX * this.curShoulder, this.focus.y, this.focus.z + rightZ * this.curShoulder);
      let want = dist;
      if (this.collide) {
        _d.set(pivot.x - dirX * dist, pivot.y - dirY * dist, pivot.z - dirZ * dist);
        want = Math.min(dist, this.collide(pivot, _d, dist));
      }
      this.curDist = want < this.curDist ? damp(this.curDist, want, 25, dt) : damp(this.curDist, want, 3, dt);
      cam.position.set(pivot.x - dirX * this.curDist, pivot.y - dirY * this.curDist, pivot.z - dirZ * this.curDist);
      this._look.copy(pivot).addScaledVector(_e.set(dirX, dirY, dirZ), 10);
      this.curFov = damp(this.curFov, fov + this.fovAdd, 6, dt);
    } else if (this.mode === 'fly') {
      // Debug fly camera: mouse looks, WASD moves, Shift is fast.
      if (look) { this.flyYaw -= look.x * sens; this.flyPitch = clamp(this.flyPitch - look.y * sens * (G.settings?.invertY ? -1 : 1), -1.5, 1.5); }
      const m = G.input.move(), sp = (G.input.isDown('sprint') ? 120 : 30) * dt;
      const fx = Math.sin(this.flyYaw) * Math.cos(this.flyPitch), fy = Math.sin(this.flyPitch), fz = Math.cos(this.flyYaw) * Math.cos(this.flyPitch);
      cam.position.x += (fx * m.y - Math.cos(this.flyYaw) * m.x) * sp; cam.position.y += fy * m.y * sp; cam.position.z += (fz * m.y + Math.sin(this.flyYaw) * m.x) * sp;
      this._look.set(cam.position.x + fx, cam.position.y + fy, cam.position.z + fz);
    } else if (this.mode === 'static') {
      if (this.smoothStatic) { cam.position.lerp(this.staticPos, 1 - Math.exp(-this.smoothStatic * dt)); this._look.lerp(this.staticLook, 1 - Math.exp(-this.smoothStatic * dt)); }
      else { cam.position.copy(this.staticPos); this._look.copy(this.staticLook); }
      this.curFov = damp(this.curFov, this.fov + this.fovAdd, 4, dt);
    } else if (this.mode === 'orbit') {
      const o = this.orbit;
      o.angle += o.speed * dt;
      cam.position.set(o.center.x + Math.sin(o.angle) * o.radius, o.center.y + o.height, o.center.z + Math.cos(o.angle) * o.radius);
      this._look.copy(o.center);
      this.curFov = damp(this.curFov, this.fov + this.fovAdd, 4, dt);
    } else if (this.mode === 'shot' && this.shot) {
      const s = this.shot;
      s.t = Math.min(1, s.t + dt / s.dur);
      const k = s.ease(s.t);
      if (s.pc) s.pc.getPoint(k, cam.position); else cam.position.copy(s.p0);
      if (s.lc) s.lc.getPoint(k, this._look); else this._look.copy(s.l0);
      if (s.fov) this.curFov = damp(this.curFov, s.fov, 3, dt);
      if (s.t >= 1 && s.resolve) { const r = s.resolve; s.resolve = null; r(); }
    }

    cam.lookAt(this._look);
    if (this.mode !== 'follow' && !G.settings?.reduceMotion) {
      const t = this.t;
      cam.rotateY(Math.sin(t * 0.37) * 0.0035 + Math.sin(t * 0.91) * 0.0015);
      cam.rotateX(Math.sin(t * 0.29 + 1.3) * 0.003 + Math.sin(t * 1.13) * 0.001);
    }
    // Trauma shake: amplitude = trauma^2, smooth pseudo-noise.
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
    const sh = this.trauma * this.trauma;
    if (sh > 0.0001) {
      const t = this.t * 22;
      const n = (o) => Math.sin(t * 1.0 + o) * 0.5 + Math.sin(t * 2.3 + o * 1.7) * 0.3 + Math.sin(t * 4.1 + o * 2.9) * 0.2;
      cam.rotateY(n(1.3) * 0.045 * sh);
      cam.rotateX(n(4.7) * 0.045 * sh);
      cam.rotateZ(n(9.1) * 0.06 * sh);
    }
    this.kickFov = damp(this.kickFov, 0, 9, dt);
    this.punchYaw = damp(this.punchYaw, 0, 12, dt); this.punchPitch = damp(this.punchPitch, 0, 12, dt);
    if (this.punchYaw || this.punchPitch) { cam.rotateY(this.punchYaw); cam.rotateX(this.punchPitch); }
    const fovNow = this.curFov + this.kickFov;
    if (Math.abs(cam.fov - fovNow) > 0.01) { cam.fov = fovNow; cam.updateProjectionMatrix(); }
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
