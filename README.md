# NOSTOS: The Long Way Home

A cinematic 3D browser action-adventure inspired by Homer's *Odyssey*. Everything you see and hear is generated in the browser: models, textures, the ocean, music, and sound. There are no asset files.

**Current build: vertical slice.** Live title screen → sailing map → **Chapter III: The Cave of the Cyclops**, complete with its peak moment and both endings of its final choice.

## Run it

Needs Node.js (any recent version) and an internet connection for three.js and the fonts (loaded from CDN).

```bash
node server.js
```

Then open http://localhost:8080. Click once to give the page focus and pointer lock.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move / look | WASD · mouse | Left / right stick |
| Sprint | Shift | L3 |
| Crouch / sneak | C or Ctrl | B |
| Attack (sword) / fire (bow) | Left mouse | X |
| Shield (hold, parry on impact) / aim bow | Right mouse | LT |
| Dodge roll | Space | A |
| Interact (some actions are held) | E | Y |
| Switch sword / bow | Q | LB |
| Lock on | F or middle mouse | RB |
| Shout (final choice) | R | R3 |
| Pause | Esc / P | Menu |
| Debug overlay / debug menu | F3 / F4 | |
| Combat tuning panel | F6 | |

Every key can be rebound in Settings → Controls.

## What's in the slice

- **Title**: the ship under sail at sunset, slow cinematic cuts, menus (continue, chapters, journal, settings, credits).
- **Sailing map**: steer by wind, manage supplies, find Athena's shrine and a wreck, follow the smoke to the Cyclops' island.
- **Chapter III**, in seven checkpointed beats:
  1. Landfall at dusk; a boar fight that teaches block, parry, roll, and bow.
  2. The empty cave, then a stay-or-leave choice, then *Hide!* before the footsteps arrive.
  3. Stealth: find the staff in the moonbeam, sharpen it only while his noise covers yours, offer the wine, and give your name (or Nobody's).
  4. **The stake**: heartbeat, slow motion, one input, white silence, the roar.
  5. Blind fury, then *Nobody is killing me!*
  6. Dawn: cling beneath the great ram through three hand passes.
  7. Blinding daylight, a boulder barrage, the ship, and the final choice: stay silent, or shout your name.

Crew losses are permanent and carried in the save. The chapter summary names who came out of the cave and who is remembered.

## Debug

**F4** opens the debug menu: god mode, Cunning and Wrath, a jump to any checkpoint or peak moment, time scale, and a fly camera for inspecting the world. **F3** shows FPS, frame time, draw calls, and triangles. **F6** opens the live combat tuning panel (parry windows, hit-stop, shake, knockback, gamepad curve, aim assist), with three preset slots and JSON export. In the browser console, `NOSTOS` exposes the game context.

## Recorded voice for the Cyclops (optional)

Drop WAV or OGG files into `assets/voice/` and list them in `assets/voice/manifest.json`: a `roars` array, and `lines` keyed by the exact subtitle text. They play through the same chain as the synthesized voice: pitch down, saturation, sub layer, distance filter, cave reverb.

See [CHANGELOG.md](CHANGELOG.md) for the enhancement pass: audit, changes, and final combat values.

## Quality presets

Low, Medium, High, and Ultra are auto-detected on the first run and can be changed in Settings → Graphics. They control resolution, shadows (including firelight shadows on High+), bloom and god rays, ocean mesh density, grass, and particles.

See [DESIGN.md](DESIGN.md) for pillars, the tension map of all 11 chapters, and the architecture.
