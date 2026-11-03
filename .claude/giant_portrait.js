// Dev harness (paste-run via the browser tool): frames the Cyclops' face in firelight, 3/4 from below.
// window.giantShot(yawOffset, dist, height, fov)
window.giantShot = async (yawOff = 0.55, dist = 2.6, up = -0.35, fov = 32) => {
  const G = window.NOSTOS, w = (ms) => new Promise((r) => setTimeout(r, ms));
  let s = G.engine.scene;
  if (!s || s.constructor.name !== 'CaveChapter' || s.zone !== s.int) {
    const { GameState } = await import('/src/core/State.js');
    G.state = new GameState();
    await G.flow.jump('stealth');
    await w(3000);
    s = G.engine.scene;
  }
  const V = s.player.pos.constructor, g = s.cyclops;
  s.stealthOn = false; g.perception = false; s.player.control = false;
  s.player.root.visible = false; for (const c of s.crew) c.root.visible = false;
  g.stopWalk(); g.setActivity(window.giantActivity || 'idle'); g.headTarget = null;
  G.ui.showHUD(false); G.ui.subtitle(null, '', 0.01);
  await w(600);
  const h = g.model.head.getWorldPosition(new V());
  const fwd = new V(Math.sin(g.yaw + yawOff), 0, Math.cos(g.yaw + yawOff));
  const sc = g.model.root.scale.x;
  const look = h.clone().add(new V(0, 0.11 * sc, 0));
  G.rig.setStatic(look.clone().addScaledVector(fwd, dist * sc * 0.25).add(new V(0, up * sc * 0.25, 0)), look, 0);
  G.rig.fov = fov;
  await w(900);
  return 'framed';
};
