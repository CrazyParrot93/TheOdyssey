// Data-driven look and structure of the journey.

// Color grades (display space, after tonemapping).
export const GRADES = {
  neutral:  { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1, contrast: 1, tint: [1, 1, 1], vignette: 0.3, grain: 0.03, exposure: 1 },
  title:    { lift: [0.03, 0.01, 0.04], gamma: [1.02, 0.98, 0.94], gain: [1.06, 1.0, 0.9], sat: 1.12, contrast: 1.06, tint: [1, 0.98, 0.96], vignette: 0.45, grain: 0.035, exposure: 1 },
  sea:      { lift: [0.01, 0.015, 0.03], gamma: [1, 1, 0.98], gain: [1.04, 1.0, 0.94], sat: 1.1, contrast: 1.05, tint: [1, 1, 1], vignette: 0.35, grain: 0.03, exposure: 1 },
  dusk:     { lift: [0.03, 0.02, 0.045], gamma: [1.06, 1.02, 1.0], gain: [1.08, 1.02, 0.95], sat: 1.05, contrast: 1.06, tint: [1, 0.96, 0.95], vignette: 0.45, grain: 0.04, exposure: 1 },
  cave:     { lift: [0.012, 0.009, 0.012], gamma: [0.97, 0.99, 1.05], gain: [1.08, 0.99, 0.86], sat: 0.84, contrast: 1.2, tint: [1, 0.97, 0.92], vignette: 0.6, grain: 0.05, exposure: 1 },
  dread:    { lift: [0.022, 0.024, 0.038], gamma: [1.04, 1.06, 1.12], gain: [1.06, 0.95, 0.86], sat: 0.62, contrast: 1.1, tint: [1, 0.96, 0.92], vignette: 0.55, grain: 0.05, exposure: 1.08 },
  dawn:     { lift: [0.02, 0.025, 0.05], gamma: [1, 1, 1.02], gain: [1.05, 1.0, 0.95], sat: 1.0, contrast: 1.08, tint: [1, 1, 1.02], vignette: 0.5, grain: 0.04, exposure: 1 },
  daylight: { lift: [0.04, 0.035, 0.02], gamma: [1.05, 1.03, 0.98], gain: [1.12, 1.06, 0.92], sat: 1.05, contrast: 1.1, tint: [1.02, 1, 0.94], vignette: 0.35, grain: 0.03, exposure: 1.05 },
  storm:    { lift: [0.01, 0.015, 0.025], gamma: [0.95, 0.98, 1.04], gain: [0.92, 0.96, 1.02], sat: 0.6, contrast: 1.18, tint: [0.96, 0.99, 1.03], vignette: 0.6, grain: 0.05, exposure: 0.95 },
  afterglow:{ lift: [0.04, 0.02, 0.03], gamma: [1.04, 1.0, 0.95], gain: [1.08, 1.0, 0.88], sat: 1.15, contrast: 1.04, tint: [1.02, 0.99, 0.95], vignette: 0.4, grain: 0.03, exposure: 1.02 },
};

// Sky + light + water palettes. Angles in degrees.
export const SKIES = {
  sunset: {
    exposure: 1, sunElev: 6, sunAz: 200, zenith: '#21406f', horizon: '#f2a464', ground: '#2b2633', sunColor: '#ffbf80', sunInt: 3.2,
    cloudColor: '#ffd3a6', cloudShadow: '#5e4a66', cloud: 0.48, fog: '#c48e70', fogDensity: 0.0009,
    light: '#ffb57a', lightI: 2.6, hemiSky: '#7fa0d4', hemiGround: '#4b3a2c', hemiI: 0.75,
    deep: '#08263a', shallow: '#2b9a92', sss: '#3dbfa6', foam: '#f4ece0',
  },
  dusk: {
    exposure: 1.04, sunElev: 8, sunAz: 215, zenith: '#24406e', horizon: '#e89a68', ground: '#2a2630', sunColor: '#ffb070', sunInt: 2.8,
    cloudColor: '#f6b48a', cloudShadow: '#4e4060', cloud: 0.5, fog: '#b98a7c', fogDensity: 0.0013,
    light: '#ffb27a', lightI: 2.8, hemiSky: '#8aa0d0', hemiGround: '#5a4434', hemiI: 1.25,
    deep: '#061c2e', shallow: '#227e7c', sss: '#2f9e8e', foam: '#eadfd4',
  },
  night: {
    exposure: 0.92, sunElev: 28, sunAz: 140, zenith: '#050a18', horizon: '#1c2a44', ground: '#0a0c12', sunColor: '#9fb4dc', sunInt: 0.6,
    cloudColor: '#3a4a66', cloudShadow: '#0c1220', cloud: 0.35, fog: '#141c2c', fogDensity: 0.003,
    light: '#8ea6d8', lightI: 0.35, hemiSky: '#2a3a60', hemiGround: '#0e0c10', hemiI: 0.3,
    deep: '#020a14', shallow: '#0e3a44', sss: '#164a50', foam: '#9aa8b8', stars: 1,
  },
  dawn: {
    exposure: 1, sunElev: 4, sunAz: 80, zenith: '#3a5c8e', horizon: '#f6c08a', ground: '#3a3640', sunColor: '#ffd6a0', sunInt: 3.0,
    cloudColor: '#ffe0c0', cloudShadow: '#7a6a86', cloud: 0.4, fog: '#d8b49a', fogDensity: 0.001,
    light: '#ffcf9a', lightI: 2.4, hemiSky: '#9ab8e0', hemiGround: '#5a4a3a', hemiI: 0.8,
    deep: '#0a2e44', shallow: '#36a8a0', sss: '#4ac8b0', foam: '#f8f0e6',
  },
  daylight: {
    exposure: 0.94, sunElev: 38, sunAz: 120, zenith: '#2f6cb8', horizon: '#cfe0ea', ground: '#5a5650', sunColor: '#fff0d0', sunInt: 3.6,
    cloudColor: '#ffffff', cloudShadow: '#9aa8b8', cloud: 0.32, fog: '#c8dae4', fogDensity: 0.0009,
    light: '#fff2da', lightI: 3.6, hemiSky: '#9cc4f0', hemiGround: '#7a6a50', hemiI: 0.9,
    deep: '#0a3a5c', shallow: '#3cc0b8', sss: '#50e0c0', foam: '#ffffff',
  },
  storm: {
    exposure: 0.95, sunElev: 20, sunAz: 140, zenith: '#2a3038', horizon: '#5c656e', ground: '#22262a', sunColor: '#9aa4b0', sunInt: 0.6,
    cloudColor: '#6a7480', cloudShadow: '#1e2228', cloud: 0.92, fog: '#4a525a', fogDensity: 0.0042,
    light: '#a8b4c4', lightI: 0.7, hemiSky: '#6a7890', hemiGround: '#2a2a2a', hemiI: 0.6,
    deep: '#0a1a22', shallow: '#2a5a5a', sss: '#3a7070', foam: '#e8eef2', storm: 1,
  },
};

export const CHAPTERS = [
  { n: 1,  id: 'troy',     title: "Troy's Shore",         sub: 'Ash, smoke, and the long road home',     playable: false, palette: ['#3a2a24', '#c2541e', '#f0a050'] },
  { n: 2,  id: 'lotus',    title: 'The Lotus-Eaters',      sub: 'A sweetness that steals the way home',   playable: false, palette: ['#f2d0e0', '#c8e0d0', '#f8f0c8'] },
  { n: 3,  id: 'cyclops',  title: 'The Cave of the Cyclops', sub: 'My name is Nobody',                     playable: true,  palette: ['#0c0806', '#d8862e', '#3a2a1e'] },
  { n: 4,  id: 'aeolus',   title: 'The Isle of Winds',     sub: 'A gift tied shut with silver',           playable: false, palette: ['#7ab8e8', '#e8f4fa', '#c89a50'] },
  { n: 5,  id: 'circe',    title: "Circe's Hall",          sub: 'Beasts with men\'s eyes',                playable: false, palette: ['#1a6a4a', '#6a3a8a', '#d8c8a0'] },
  { n: 6,  id: 'underworld', title: 'The House of the Dead', sub: 'Blood for the shades, truth for the living', playable: false, palette: ['#5a6e6a', '#a8b8b4', '#1e2826'] },
  { n: 7,  id: 'sirens',   title: 'The Sirens',            sub: 'A song that knows your name',            playable: false, palette: ['#e8b8a0', '#d89870', '#f8e0c8'] },
  { n: 8,  id: 'strait',   title: 'Scylla and Charybdis',  sub: 'Choose whom you lose',                   playable: false, palette: ['#4a5258', '#e8eef0', '#1a2228'] },
  { n: 9,  id: 'sun',      title: 'Cattle of the Sun',     sub: 'Hunger is a kind of madness',            playable: false, palette: ['#f8d070', '#fff4c0', '#a86a20'] },
  { n: 10, id: 'calypso',  title: "Calypso's Isle",        sub: 'Seven years and one raft',               playable: false, palette: ['#20b8b0', '#e8f0d0', '#2a6a4a'] },
  { n: 11, id: 'ithaca',   title: 'Ithaca',                sub: 'The bow no one else can string',         playable: false, palette: ['#e8b060', '#fff0d0', '#6a4020'] },
];

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
