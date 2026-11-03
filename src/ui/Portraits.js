// Red-figure vase-painting portraits: terracotta profile on black glaze, archaic frontal eye.
const cache = new Map();

export function portrait(person, size = 160) {
  const key = person.id + size;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / 160;
  g.scale(s, s);
  const look = person.look || {};
  // glaze background with meander frame
  g.fillStyle = '#16100c'; g.fillRect(0, 0, 160, 160);
  g.strokeStyle = '#b86a3c'; g.lineWidth = 2;
  for (let x = 6; x < 154; x += 14) {
    g.beginPath(); g.moveTo(x, 152); g.lineTo(x, 144); g.lineTo(x + 10, 144); g.lineTo(x + 10, 150); g.lineTo(x + 5, 150); g.stroke();
  }
  const terra = person.id === 'polyphemus' ? '#a65a34' : '#c8703e';
  const line = '#1a0f0a';
  g.fillStyle = terra;
  if (look.cyclops) drawCyclops(g, terra, line);
  else drawProfile(g, look, terra, line, person.id === 'odysseus');
  const lost = person.lost;
  if (lost) { g.fillStyle = 'rgba(10,8,8,0.55)'; g.fillRect(0, 0, 160, 160); }
  cache.set(key, c);
  return c;
}
export function clearPortraitCache(id) { for (const k of [...cache.keys()]) if (k.startsWith(id)) cache.delete(k); }

function drawProfile(g, look, terra, line, hero) {
  const grey = look.grey || 0;
  // neck and shoulders
  g.beginPath(); g.moveTo(52, 140); g.lineTo(60, 108); g.lineTo(86, 106); g.lineTo(96, 140); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(76, 146, 52, 14, 0, Math.PI, 0); g.fill();
  // head profile facing right
  g.beginPath();
  g.moveTo(52, 50);
  g.bezierCurveTo(54, 26, 92, 18, 106, 40); // skull
  g.lineTo(112, 58);                          // forehead
  g.lineTo(122, 74);                          // straight Greek nose
  g.lineTo(112, 76);
  g.lineTo(113, 82);                          // lips
  g.lineTo(110, 85);
  g.lineTo(111, 90);
  g.bezierCurveTo(108, 100, 96, 104, 84, 102); // chin & jaw
  g.lineTo(62, 98);
  g.bezierCurveTo(48, 90, 46, 70, 52, 50);
  g.fill();
  g.strokeStyle = line; g.lineWidth = 1.6; g.stroke();
  // archaic frontal eye
  g.fillStyle = '#efe0c8';
  g.beginPath(); g.moveTo(94, 60); g.quadraticCurveTo(101, 55, 108, 60); g.quadraticCurveTo(101, 64, 94, 60); g.fill();
  g.fillStyle = line; g.beginPath(); g.arc(102, 60, 2.2, 0, 7); g.fill();
  g.strokeStyle = line; g.lineWidth = 1.2; g.beginPath(); g.moveTo(92, 54); g.quadraticCurveTo(101, 49, 110, 54); g.stroke();
  // ear
  g.beginPath(); g.ellipse(70, 64, 5, 8, 0.2, 0, 7); g.stroke();
  const hairCol = grey > 0.6 ? '#8a7a6a' : line;
  g.fillStyle = hairCol;
  if (hero) {
    // Corinthian helmet pushed back with crest
    g.fillStyle = '#c8873a';
    g.beginPath(); g.moveTo(48, 58); g.bezierCurveTo(46, 20, 100, 10, 110, 42); g.lineTo(98, 48); g.bezierCurveTo(88, 34, 66, 36, 60, 60); g.closePath(); g.fill();
    g.strokeStyle = line; g.stroke();
    g.fillStyle = '#8a1c14';
    g.beginPath(); g.moveTo(40, 30); g.bezierCurveTo(60, -4, 100, 0, 112, 26); g.lineTo(102, 30); g.bezierCurveTo(90, 14, 64, 14, 52, 36); g.closePath(); g.fill();
  } else {
    // hair: curls band
    g.beginPath(); g.moveTo(50, 62); g.bezierCurveTo(46, 22, 96, 14, 108, 42); g.lineTo(100, 44); g.bezierCurveTo(92, 34, 70, 32, 64, 50); g.lineTo(60, 66); g.closePath(); g.fill();
    g.fillStyle = terra; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(58 + i * 8, 34 - Math.sin(i * 0.6) * 6, 1.6, 0, 7); g.fill(); }
    if (look.cap === 'band') { g.strokeStyle = '#efe0c8'; g.lineWidth = 3; g.beginPath(); g.moveTo(54, 44); g.quadraticCurveTo(80, 30, 106, 44); g.stroke(); }
    if (look.cap === 'bronze') { g.fillStyle = '#c8873a'; g.beginPath(); g.moveTo(50, 46); g.lineTo(78, 6); g.lineTo(108, 42); g.closePath(); g.fill(); g.strokeStyle = line; g.lineWidth = 1.4; g.stroke(); }
  }
  // beard
  g.fillStyle = hairCol;
  const b = look.beard;
  if (b && b !== 'none') {
    const len = b === 'long' ? 26 : b === 'full' ? 16 : 7;
    g.beginPath(); g.moveTo(68, 80); g.lineTo(84, 86); g.lineTo(104, 86); g.lineTo(111, 92);
    g.bezierCurveTo(110, 98 + len * 0.6, 100, 104 + len, 90, 100 + len); g.bezierCurveTo(80, 100 + len * 0.6, 68, 98, 64, 88); g.closePath(); g.fill();
    g.strokeStyle = terra; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(80 + i * 6, 92); g.quadraticCurveTo(82 + i * 6, 98 + len * 0.5, 78 + i * 6, 100 + len * 0.7); g.stroke(); }
  }
  // tunic edge
  g.strokeStyle = line; g.lineWidth = 1.5; g.beginPath(); g.moveTo(40, 140); g.quadraticCurveTo(76, 128, 112, 140); g.stroke();
}

function drawCyclops(g, terra, line) {
  g.beginPath(); g.ellipse(80, 150, 70, 26, 0, Math.PI, 0); g.fill();
  g.beginPath(); g.ellipse(80, 76, 50, 58, 0, 0, 7); g.fill();
  g.strokeStyle = line; g.lineWidth = 2; g.stroke();
  g.fillStyle = line;
  g.beginPath(); g.ellipse(80, 30, 52, 24, 0, Math.PI, 0); g.fill();
  for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(34 + i * 11.5, 30 + Math.sin(i) * 4, 7, 0, 7); g.fill(); }
  g.beginPath(); g.moveTo(40, 98); g.bezierCurveTo(50, 150, 110, 150, 120, 98); g.lineTo(104, 104); g.lineTo(56, 104); g.closePath(); g.fill();
  g.strokeStyle = terra; g.lineWidth = 1.2; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(54 + i * 10, 108); g.quadraticCurveTo(56 + i * 10, 124, 52 + i * 10, 138); g.stroke(); }
  g.fillStyle = '#efe0c8'; g.beginPath(); g.ellipse(80, 62, 18, 12, 0, 0, 7); g.fill();
  g.fillStyle = line; g.beginPath(); g.arc(80, 62, 7, 0, 7); g.fill();
  g.strokeStyle = line; g.lineWidth = 4; g.beginPath(); g.moveTo(56, 46); g.quadraticCurveTo(80, 36, 104, 46); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.moveTo(80, 70); g.lineTo(74, 86); g.lineTo(84, 88); g.stroke();
}
