# NOSTOS: The Long Way Home — Design Document

A cinematic, mythic 3D action-adventure for the browser, inspired by Homer's Odyssey.
All art, models, music, and writing are original and procedurally generated.

---

## 1. Pillars

| # | Pillar | What it means in play |
|---|--------|-----------------------|
| 1 | **Cunning over strength** | Every threat has a clever answer that beats the strong one. Stealth, deception, and timing earn **Cunning**; brute force costs **crew**. |
| 2 | **Every life matters** | Crew are named people with faces and voices. Losses are permanent, announced, and read out in the ending. |
| 3 | **The sea is a character** | One shared Gerstner wave function drives the ocean shader *and* ship buoyancy. Poseidon's **Wrath** makes the sea itself hostile. |
| 4 | **Earned triumph** | Each chapter is built around one climax. Pressure builds for minutes, then a single player input releases it. |
| 5 | **Home** | The lyre "Home" motif plays at the title, returns quietly in afterglows, and is meant to land in full at Ithaca. |

**Core loop:** Sail → Discover island → Explore & survive → Outwit the threat → Climax → Consequence → Sail on, changed.

---

## 2. Tension map (all 11 chapters)

Intensity 1–10. Peaks alternate with breathers so each spike lands higher.

```
10 |                  ██                          ██                ██
 9 |      ██          ██             ██           ██                ██
 8 |      ██          ██    ██       ██     ██    ██                ██
 7 | ██   ██          ██    ██       ██     ██    ██                ██
 6 | ██   ██    ██    ██    ██       ██     ██    ██          ██    ██
 5 | ██   ██    ██    ██    ██  ██   ██     ██    ██    ██    ██    ██
 4 | ██   ██    ██    ██    ██  ██   ██  ██ ██    ██    ██    ██    ██
 3 | ██   ██    ██    ██    ██  ██   ██  ██ ██    ██    ██    ██    ██
   +-----------------------------------------------------------------
     1    2     3     4     5   6    7   8  9     10    11 (finale)
   Troy Lotus Cyclops Aeolus Circe Under Sirens Scylla Sun Calypso Ithaca
```

| Ch | Name | Unique mechanic | Set piece | Choice | Peak moment |
|----|------|-----------------|-----------|--------|-------------|
| 1 | Troy's Shore | Rearguard escort | Burning city run | Save stragglers vs. hold the gate | Fleet sails against a wall of fire |
| 2 | Lotus-Eaters | Dream-haze perception | Color draining from the world | Drag men vs. leave the lost | Last man aboard, color snaps back |
| **3** | **Cyclops' Cave** *(vertical slice)* | **Sound-masked stealth** | **Blinding the giant, escape under sheep** | **Shout your name or stay silent** | **"My name is Nobody" → the stake → daylight** |
| 4 | Aeolus | Wind-bag sailing | Ithaca on the horizon | Trust vs. watch the crew | Bag tears; hurricane steals triumph |
| 5 | Circe *(breather)* | Moly alchemy | Hall of beasts | Stay a year vs. leave | Crew turned back, face by face |
| 6 | Underworld *(breather)* | Blood-offering shades | River of souls | Whom to speak with | A known shade; the prophecy |
| 7 | Sirens | Song warps input/screen/audio | Lashed to the mast | Wax for all vs. listen | Song cuts out; dead calm |
| 8 | Scylla & Charybdis | Split-second helm | The strait | Six men vs. the whole ship | Six names fade from the roster |
| 9 | Cattle of the Sun | Hunger vs. oath | Starving island | Guard vs. sleep | Lightning splits the ship |
| 10 | Calypso *(breather)* | Raft building | Dawn launch | Immortality vs. home | First wave crested |
| 11 | Ithaca | Disguise & bow | The hall of suitors | Mercy vs. vengeance | The bow, the axes, the reunion |

---

## 3. Chapter III — The Cave of the Cyclops (built backward from its climax)

**Climax (designed first):** in total silence, the player carries a fire-hardened olive stake to the sleeping giant's face. Heartbeat. Slow motion. One input. White. Silence. Then the roar.

**Setups and payoffs**

| Setup | Payoff |
|-------|--------|
| Perimedes on the beach: *"Maron's wine. Strong enough to drop a god."* | The wine puts Polyphemus to sleep. |
| Thrasios at the staff: *"Green olive. Long as a mast."* | It becomes the stake. |
| Damon: *"Scrape when he's loud."* (sound masking) | Teaches the stealth rule before it matters. |
| The name question ("Nobody") | His brothers ignore his cries. A true name brings them. |
| The ram is first to the meadow every morning | His last words to the ram as you cling beneath it. |
| The final choice to shout your name | Wrath, the curse, and a storm that follows you. |

**Beat sheet / tension curve**

1. *Landfall at dusk* (3/10): beach, smoke on the mountain, crew chatter, wine setup.
2. *Boar grove* (5/10): combat taught safely: block, parry, roll, bow. Crew help.
3. *The empty cave* (4/10): huge cheeses and pens. Choice: stay or take and go.
4. *Hide!* (7/10): footsteps shake the cave. 18 seconds to drag two greedy men into shadow.
5. *Stealth* (6→8/10): find the staff in the moonbeam, sharpen it only while his noise masks yours.
6. *The wine* (7/10): step into his firelight. Timed name choice.
7. *Harden the point* (8/10): the cave goes dark and quiet.
8. ***The stake*** (10/10): the decisive input, then silence, then the roar.
9. *Blind fury* (9/10): dodge his blind, telegraphed slams.
10. *Under the ram* (8/10): balance through three hand passes. His monologue to the ram.
11. *Blinding daylight* (9/10): run the boulder barrage to the ship.
12. *The choice* (afterglow or storm): stay silent, or shout your name into the wind.

---

## 4. Systems

- **Cunning** earned through stealth, clever dialogue, avoiding fights. Unlocks Athena hints/powers.
- **Poseidon's Wrath** (0–10) raises wave steepness and storm frequency, and makes enemies fiercer.
- **Crew**: 24 named sailors with procedural red-figure portraits; 12 land on the Cyclops' island.
- **Combat**: 3-hit sword combo, shield block, perfect parry (generous window) → riposte, dodge roll with i-frames, stamina, bow with aim mode and limited arrows. Hit-stop, trauma shake, rumble, sparks, and a light flash on every hit.
- **AI**: perception with sight cones, light level, hearing, and memory of last-known position. Boars telegraph, take turns, and feint if you spam parries. The Cyclops' head tracks sounds.
- **Endings** (planned): Hero's Return / Lone Survivor / Bitter Homecoming, from crew saved, Cunning, and Wrath.

---

## 5. Art direction

Stylized realism: "a living fresco at golden hour". Painterly gradients, strong silhouettes.

- **Ocean**: 6-octave Gerstner (GPU + identical CPU sampling), depth absorption from a terrain heightmap, fresnel sky reflection, crest subsurface glow, crest and shore foam, Kelvin wake, sun glitter.
- **Sky**: procedural gradient, sun and halo, fbm clouds lit from the sun side, lightning flash.
- **Post**: bloom → god rays, chromatic aberration, radial blur → ACES tonemap → lift/gamma/gain grade, vignette, grain, flash, colorblind daltonization.
- **Height fog**: patched into all three.js fog chunks globally.
- **Palettes per chapter** (data-driven in `src/data/chapters.js`).

---

## 6. Audio

Fully synthesized with Web Audio: buses (master, music, sfx, ambience, voice), dialogue ducking, convolution reverb, HRTF spatial panning.
**Music Director**: a modal score (Dorian/Phrygian), drone, Karplus-Strong lyre, formant choir pads, frame drums in 7/8 aksak. Moods crossfade (explore → tension → stealth → combat → climax → afterglow), and stingers fire on the exact frame of the decisive input.

---

## 7. File structure

```
index.html            import map (three r170), fonts, canvas
server.js             zero-dependency static server (node server.js)
css/style.css         Greek UI: meander, bronze, marble, Cinzel
src/
  main.js             boot, quality detect, wiring
  core/               context, EventBus, Config, Save, State, Input, Engine, math
  render/             PostFX, Sky (Atmosphere), Ocean, Particles (+Rain, Trail)
  assets/             Assets (procedural textures, materials, models), Character (rigs + animation)
  audio/              AudioEngine (buses, ambience, sfx), Music (Music Director)
  game/               CameraRig, Player, Crew, Boar, Cyclops, NavGrid, Terrain, Script, Flow
  scenes/             TitleScene, SailingScene, CaveChapter
  ui/                 UI (HUD, dialogue, menus, settings, journal, summary), Debug, Portraits
  data/               chapters, crew, dialogue, lore
```

---

## 8. Delivery status

- [x] Design document
- [x] Foundation: fixed-timestep engine, input + rebinding + gamepad, camera, ocean, lighting, post, audio
- [x] Vertical slice: live title, sailing map, full Cyclops chapter with its peak moment
- [x] Polish pass on the slice (first pass, see the critique below)
- [ ] Chapters 1, 2, 4–11 (data stubs and palettes exist; marked "in development" in chapter select)
- [ ] Whole-game pacing pass and endings

## 9. Creative-director critique after the slice

Fixed during the polish pass:
- Reversed-edge `smoothstep` in three shaders (undefined in GLSL) made particles render as squares, causing the "checkerboard" sea and the blocky dust.
- The cave had no real doorway, so the giant's silhouette entrance had no light behind it. The dome is now cut and a stone tunnel frames the dusk.
- The sleeping giant's head lay in the hearth, and the pre-stake camera clipped into his body. The sleep spot has moved, the camera locks onto the eye inside 8 m, and the hardened stake tip now throws its own light onto his face.
- The dusk exterior was crushed to red-black. Golden-hour lighting, fill, and grade are retuned.
- Crew formation sat between the player and the camera. Now they flank, and fade when the camera gets too close.
- Seizures happened in the dark. He now lights the fire first, and a key light falls on the victim.

Weakest elements remaining (next polish targets):
1. **Characters**: procedural capsule rigs read as mannequins up close. They need sculpted silhouettes (cuirass and chiton folds, hands, faces) and secondary motion.
2. **Combat feel by hand**: AI states, parry, hit-stop, and hit feedback are verified in code and in scripted runs. Timing windows and the weight of the hits still need a hands-on tuning pass with mouse and gamepad.
3. **Voice of the giant**: the synthesized roar and voice blips carry the scenes but don't yet *terrify*. A layered, pitch-shifted vocal design (and real VO later) would raise every Polyphemus beat.
