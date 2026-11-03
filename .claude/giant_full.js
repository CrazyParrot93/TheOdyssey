// Dev harness: full-body framing of the Cyclops in the cave with a soft key light.
// await import('/.claude/giant_full.js'); await giantFull(yawOff, dist, camY, lookY, key)
window.giantFull = async (yawOff = 0.6, dist = 11, camY = 4.2, lookY = 4, key = 160) => {
  await import('/.claude/giant_portrait.js?' + Date.now());
  const G = window.NOSTOS;
  let s = G.engine.scene;
  if (!s || s.constructor.name !== 'CaveChapter' || s.zone !== s.int) { await window.giantShot(0.5, 14, -2, 50); s = G.engine.scene; }
  const g = s.cyclops, I = s.int, V = g.pos.constructor;
  const f = new V(Math.sin(g.yaw + yawOff), 0, Math.cos(g.yaw + yawOff));
  const rim = I.dramaLight; rim.color.set(0xffc890); rim.intensity = key;
  rim.position.copy(g.pos).addScaledVector(f, 14).setY(9); rim.target.position.copy(g.pos).setY(4);
  G.rig.setStatic(g.pos.clone().addScaledVector(f, dist).setY(g.pos.y + camY), g.pos.clone().setY(g.pos.y + lookY), 0);
  G.rig.fov = 50;
  await new Promise((r) => setTimeout(r, 1200));
  return 'ok';
};
