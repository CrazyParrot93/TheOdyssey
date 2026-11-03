# NOSTOS: Master Enhancement Pass

## 1. Audit (root causes before fixing)

| Problem | Root cause |
|---|---|
| **Sun glare hides the ship** | Sun disk rendered at about 19 HDR (`sunColor × 3.2 × 6`). Ocean sun specular `pow(nh,900) × 45` reached about 140. Bloom (threshold 0.92, radius 0.65) and god rays (luminance threshold 0.85) spread both across the frame. Exposure never adapted, and nothing lit the camera-side of a backlit hull, so the ship became a flat silhouette inside a halo. |
| **Sea floods into the islands** | Island interiors sat at only +2–3 m with ±3 m noise, so hollows dipped below sea level and the global ocean plane showed through. Waves kept full amplitude in the shallows and climbed the beach. Only the nearest island's heightmap reached the shader. |
| **Mannequin characters** | Each body was stacked capsules and spheres with uniform radii and visible joints. Hands were spheres, faces a sphere plus a cone nose and two dots. There were no eyes, lids, hair strands, cloth layers, or skin shading. |
| **Untuned combat** | Parry window 0.22 s with no partial window and no penalty for spamming. Hard-coded hit-stop, shake, and rumble. Per-axis (square) gamepad deadzone with no curve. OS-accelerated mouse. No way to tune live. |
| **Unscary voice** | The roar was four detuned saws through `tanh` and two bandpasses. No inhale or silence, no sub layer, no ring modulation, no variation. Speech was generic UI blips. Reverb was a white-noise decay, and nothing ducked under his voice. |

## 2. Changes by section

### 1. Sun glare (`PostFX.js`, `Sky.js`, `Ocean.js`, `Assets.js`, `CameraRig.js`)
- **Eye adaptation:** `sunFacing = dot(cameraForward, sunDir)`. Above 0.6, exposure eases down by up to 35% with a 0.75 s time constant. It never snaps.
- **Bloom:** threshold 0.88, strength clamped at 0.8 and reduced by 45% when backlit. A **firefly clamp pass** before bloom caps isolated HDR pixels at 6.
- **God rays:** dimmed 60% when facing the sun and masked out of screen centre.
- **Sun disk** clamped (2.2× rather than 6×, ≤7 HDR); whole sky clamped at 9. **Ocean sun specular** clamped, glitter tightened, and both fade to zero within 2.5–9 m of the hull.
- **Silhouette protection:** sun-coloured rim term on ship, crew, and gear materials (`patchMaterial` in `Assets.js`). Sun-opposite fill light that strengthens when backlit. Water directly behind the ship darkens 28% in backlit views.
- **Camera:** backlit for more than 2 s with no camera input, the follow camera drifts yaw until the sun sits beside the ship (sailing and chapter exteriors).
- **Settings:** *Glare intensity* slider; *Reduce bright flashes* toggle (also scales sun glare and flashes).
- Per-preset `exposure` added to `SKIES` in `chapters.js`.
- *Verified:* orbited the ship at sunset, backlit / side / front-lit. The hull, sail, and rowers stay readable at every angle.
- **Follow-up: sailing was still washed out.** The main cause was the god rays: their luma threshold (0.85) took in the whole bright sky round a low sun, smearing a beige veil over half the frame. Now only pixels above luma 1.8 feed them (the disc and its tight halo). They fall off with distance from the sun and are capped at +0.6. At sea they are 0.22, down from 0.5.
  - Sailing bloom 0.55 → 0.42.
  - Sky halo is tighter and dimmer (`pow 8 × 0.1 + pow 64 × 0.32`, horizon glow 0.22 → 0.12). Sun disc ≤5 HDR. Cloud sun-glow is lower.
  - The ocean's broad sun sheen dropped from `pow 90 × 0.35` to `pow 120 × 0.14`. The sun-path cap dropped from 8 to 5.
  - Fog is thinner so the islands stay visible: sunset 0.0014 → 0.0009, dusk 0.0019 → 0.0013, dawn 0.0016 → 0.001, daylight 0.0012 → 0.0009.
  - Eye adaptation now starts at facing 0.4, down from 0.6, but dips at most ~30%, so looking into the sun no longer goes muddy.
  - *Verified:* sunset, dawn and daylight, both side-lit and looking straight into the sun. The horizon, islands and sun disc stay visible, with no white-out.
- **No sea inside the cave** (`AudioEngine.js`). Two bugs:
  - The swell LFO on the waves, surf and storm layers was summed straight into each layer's level gain. A layer set to 0 still swung between ±0.35, so the sea was faintly audible everywhere. The LFO now drives a separate unity "swell" gain before the level gain.
  - `setAmbience` merged each new mix into the old one. One-shot ambience (gulls, drips, crackle) carried over between areas, so beach gulls cried inside the cave and drips followed you outside. A mix is now complete: keys it leaves out are silent.
  - *Measured:* on the beach, waves are at 0.08 RMS. In the cave, waves and surf are at 0 and gulls are off.
- **Sharpening the stake is easier to find** (`CaveChapter.js`). A faint pulsing ring on the floor marks each stake step: the olive staff, then the whetstone, the sharpened stake, and the hearth. It fades out when you are standing on it. A one-time hint names the place (the dark alcove left of the entrance) and the key to hold, and says progress is kept if you let go. The mechanic itself was unchanged and works: hold Interact for 7 s in total at the whetstone while carrying the staff.
- **The camera no longer freezes after the wine** (`CaveChapter.js`). The wine scene set a static cutscene shot and never handed the camera back. It now returns to the follow camera (and pointer lock) facing the way you're looking.
- **The sleep and stake section is readable** (`chapters.js` `dread` grade, `CaveChapter.js`). Before, it rendered close to black. The grade now lifts the shadows (lift ~0.025, gamma 1.04–1.12), has normal exposure (1.08, was 0.92), lower contrast (1.1, was 1.22), and a lighter vignette (0.55, was 0.85). The dying fire burns at 0.8 instead of 0.55. A cool moonlight fill (hemisphere `#6a7aa0`, 1.0) keeps the floor and the sleeping giant visible.
- **Compass labels no longer overlap** (`UI.js`, `SailingScene.js`, `style.css`). Labels are placed in priority order: cardinals, then the goal, then nearer places. Each takes the first of two rows where its estimated width fits. A label that fits nowhere becomes a small tick mark. (Before, the row was the count of nearby labels, so two labels could land on the same row on top of each other.)

### 2. Shorelines (`Ocean.js`, `SeaWorld.js`, `CaveZones.js`)
- New island profile: seabed −7 m → beach +1.5 m → dunes / raised interior (+4 to +7.5 m) → peak. The Cyclops' island interior is floored at +1.6 m.
- The ocean shader samples **up to four island heightmaps** (`setIslands`). Wave amplitude fades to 5% in the shallows (vertex) and normals flatten (fragment). Water is discarded where terrain stands above it. Foam bands come from true depth.
- CPU buoyancy (`heightAt`) applies the same shoaling, so a moored ship sits on calm shallows.
- The ship grinds on shallows in sailing: creak + scrape, slowdown, shake, rumble.
- **Debug fly camera** (F4 → Toggle fly camera: WASD + mouse, Shift for speed).
- *Verified:* top-down fly-over of Cyclops' Isle in calm and storm seas. Clean sand ring, no inland water.

### 3. Characters (`Sculpt.js`, `Anatomy.js`, `Character.js`)
- **Chosen approach: A (sculpted procedural meshes).** It keeps the project free of third-party assets and licences, and the result is a single continuous skinned mesh with no visible joints. Approach B (CC0 glTF base meshes) wasn't needed, so no `CREDITS.md` entries were required.
- Pipeline: anatomical SDF (smooth union of ~45 muscle-group primitives) → **Naive Surface Nets** with coarse-to-fine sampling and spatial part buckets → projection onto the surface → gradient normals → **skin weights from SDF proximity** (each primitive votes for its bone) → `SkinnedMesh` on a 17-bone skeleton bound in A-pose.
- Builds: hero (lean, compact power), lean, stocky, old, and giant. Seven-and-a-half-head proportions, defined clavicles, deltoids, biceps/triceps, forearms, quads/hamstrings, calves, knees, heels.
- **Heads:** high-resolution sculpted head per face type (brow ridge, eye sockets, cheekbones, nose with nostrils, lips, jaw, chin, carved ears). **Morph targets:** jawOpen, browDown, browUp, frown, smile, squint. Expressions: anger, fear, pain, relief, grief, determination. The jaw syncs to dialogue blips and subtitles.
- **Eyes:** separate eyeballs with an iris/pupil texture and a clearcoat wet highlight. Upper lids blink every 2–6.5 s, lower lids are fixed. Eyes track the look target.
- **Hands:** separate high-resolution meshes with four three-segment fingers and a two-segment thumb in a loose grip. The sword and spear sit in the fist.
- **Hair:** an opaque scalp cap plus strand cards that flow along the scalp (alpha strands, anisotropic sheen, wind sway). Beards are cards plus a fill mass.
- **Clothing:** linen tunic with folds, a cuirass engraved with a meander band, greaves, bracers, leather pteruges, the existing cloth cloak, and a fleece loincloth for the giant. Each is an inflated SDF layer skinned to the body, with skirts biased to the hips.
- **Skin:** `MeshPhysicalMaterial` with wrap lighting, a warm red terminator, and sheen. Pore normals (wrinkles on the giant). Per-character detail map with dirt, scars, sunburn, and age speckle.
- **Animation:** idle weight shift and eye saccades added to the existing blend tree, plus foot IK, head tracking, and breathing.
- Generation runs behind the loading fade (`prebuild`, about 3 s for the whole chapter cast) and is cached per build.
- *Verified:* full-screen faces of Odysseus and Perimedes in firelight and in daylight read as people.

### 4. Combat feel (`Tuning.js`, `TuningPanel.js`, `Player.js`, `Boar.js`, `Input.js`, `CameraRig.js`)
- **F6 live tuning panel:** every value below has a slider, persists automatically, has three preset slots, and supports JSON export/import.
- Perfect parry / partial parry / block, each with distinct feedback. Whiffed parry taps lock the guard for 0.28 s. Chip damage while blocking.
- Perfect parry: 100 ms hit-stop, 46-spark burst, metallic ring + low thud, 6° zoom kick, slow-mo blend, riposte window.
- Crits blend into slow motion with a camera punch. Being hit: 80 ms hit-stop on the player, a **directional camera punch away from the blow**, a pain expression, and desaturation at low health.
- Knockback is scaled by enemy mass; the giant is immune.
- Dual-motor **rumble profiles** per event.
- **Radial deadzone + response curve**, gamepad sensitivity setting, bow **aim assist** on gamepad (toggleable).
- **Raw mouse** via `requestPointerLock({ unadjustedMovement: true })`, with fallback.
- The giant's slams are flagged **unblockable** with a red telegraph ring and a distinct brass-and-rattle warning.

### 5. The Cyclops (`Anatomy.js` giant build, `Cyclops.js`, `GiantVoice.js`, `AudioEngine.js`, `CaveChapter.js`)
- **Model**, after the reference image's direction (firelit from below; gaunt, hunched, elderly, huge hands), not its likeness. Broad bony shoulders, long arms, 1.7× hands with knuckled fingers, dowager's hump, rib grooves, knobbed elbows and knees. Bald crown with sparse wild wisps and a scraggly beard, huge ears, heavy single brow. **Single wet eye with veined sclera and a pupil that dilates in the dark and pins when he's suspicious.** Permanent hunch-crouch. Fleece loincloth with a rope belt. A whole-olive-trunk club leans by his bed.
- **Voice** (all synthesized, every parameter in `GiantVoice.js`):
  - Roar: inhale (air layer) → silence → explosive attack → sustained growl with pitch wobble → ragged decay → wet breath tail.
  - Layers: sub (30–60 Hz), formant body (AH→OH bank tuned to a giant's vocal tract), and grit (distorted noise ring-modulated at 22–38 Hz). Every roar randomizes pitch, length, and mix.
  - **Blinded scream:** higher, longer, with random pitch cracks; the most intense sound in the game.
  - **Speech:** syllable-level formant synthesis, an octave and more below a man, slow and deliberate, with a detuned double voice, a subharmonic, guttural plosive and fricative bursts, and a light ring-mod. It is driven automatically by his subtitles and dialogue lines.
  - **Recorded voice drop-in:** list WAV/OGG files in `assets/voice/manifest.json` and they run through the same chain.
- **Space:** a generated cave impulse response (14 early rock reflections + a 4 s dark tail) used inside the cave. HRTF panning plus a distance low-pass and reverb send: muffled and echoing far away, dry and huge up close. A breathing loop while he's awake.
- **Fear direction:** music and ambience drop to near-silence during the inhale, then duck about 10 dB under his voice. Every roar is synced to shake, ceiling dust, a fire flare, and rumble. Master bus: glue compressor → brickwall limiter → soft clipper.
- Introduction: silhouette in the doorway against the dusk, then lit from below as he wakes the fire.

### 6–7. Lighting and global polish
- GTAO ambient occlusion (High/Ultra), SMAA (High/Ultra), sharpening (Medium+), firefly clamp.
- Three-point lighting in the wine scene (fire key from below, cool rim behind the giant, fill), and a key light on every seizure.
- The hardened stake tip carries its own light, so the giant's face is lit by the weapon on the approach.
- Two extra close-range ocean wave octaves (8 in total, distance-faded).
- Rain darkens and glosses terrain, stone, wood, hull, and sail.
- Handheld drift on cinematic cameras (off with Reduce motion).
- Crisper type rendering. A boot frame-yield fallback, so loading never stalls in a background tab.
- Zero console errors across title → sailing → every chapter checkpoint → sailing, including chapters aborted mid-scene.

## 3. Final combat values (defaults, all tunable in F6)

| Value | Default |
|---|---|
| Input buffer | 0.18 s (attacks +0.07 s) |
| Perfect parry window | Story 0.20 s · Normal 0.15 s · Hard 0.11 s |
| Partial window / damage taken | +0.16 s / 35% |
| Block chip damage / stamina multiplier | 12% / 1.6× |
| Parry-whiff lockout | 0.28 s |
| Parry hit-stop / zoom | 0.10 s / 6° |
| Riposte window | 1.4 s |
| Hit-stop light / heavy / crit / taken | 0.05 / 0.105 / 0.17 / 0.08 s |
| Shake light / heavy / crit / taken | 0.20 / 0.40 / 0.60 / 0.45 trauma |
| Knockback light / heavy | 3 / 6.5 (÷ enemy mass; boar 1.2) |
| Crit slow-mo | 0.35× |
| Gamepad deadzone / curve / look | 0.15 radial / 1.6 / 950 |
| Bow aim assist | 0.35 |
| Low-health threshold | 35% |

Rumble profiles `[strong, weak, ms]`: light `[0.15, 0.6, 90]`, heavy `[0.7, 0.3, 220]`, crit `[1, 0.6, 260]`, parry `[0.9, 0.5, 160]`, hurt `[0.6, 0.9, 200]`, block `[0.35, 0.5, 110]`, giant step `[1, 0.1, 260]`.

## 4. New settings and config
- Settings: `glare` (0–1.5), `aimAssist`, `padSensitivity`; *Reduce bright flashes* now also scales sun glare.
- Quality presets: `ao` and `smaa` (High/Ultra).
- `SKIES[*].exposure`; `COMBAT` and `RUMBLE` in `src/core/Tuning.js`.
- Debug: F4 fly camera; F6 combat tuning.

## 5. Performance
GPU-synchronized render timing on this machine's browser pane at 1024×768, cave interior, Medium: **16.1 ms/frame**. The first profile, before trimming, was 24.6 ms. Measured costs: SMAA ~6.7 ms (now High+ only), shadows ~5.7, characters ~5.4 (eyes, lids, hair, and scalp no longer cast shadows), bloom ~4.7, instanced foliage ~4.8. This environment's GPU is much weaker than a mid-range laptop and the pane was often throttled in the background, so 60 FPS on target hardware has **not** been confirmed.

## 5b. Cyclops art pass (toward the reference still)

Matched the reference's direction (an ancient, bald, gaunt one-eyed giant, firelit from below, a man held at his chest), not the film actor's likeness.

- **New sculpted head** (`src/assets/GiantFace.js`): a single eye set high in the forehead, larger (radius 0.025) and bloodshot, with a smaller iris showing more white. A hooded upper lid, a baggy lower lid, and a wet red rim. Deep forehead furrows and concentric folds round the eye, all carved. A long, slightly hooked bony nose. Hollow temples and sunken cheeks. Soft nasolabial folds. A small, pursed, downturned mouth with marionette lines. A narrow jaw with light jowls, big ears with long lobes, and neck cords and folds. The head is now about 3 mm voxels at human scale.
- **Painted face maps** projected frontally, so lines land on the right features: fine forehead lines, crow's feet, lip lines, neck rings, raised temple veins, crepey micro-texture, cavity darkening, redness around the eye, and age spots.
- **Bald** (no hair cards or beard). Pale, desaturated skin (`#cfc0a6`). Lower ambient and environment reflection on his skin for more chiaroscuro.
- **Emaciated torso:** raised ribs, sternum, sunken belly, dowager's hump, sloping bony shoulders, thinner upper arms, softer skin weights (no shoulder crease), and fine crepey body skin.
- **Posture:** a forward "vulture" neck with the head tipped back up. The new `lift` pose draws a seized man in to the chest and turns the head to inspect him. The man hangs upright in the fist, weaponless and terrified.
- The cave grade moved from saturated orange to golden beige, and the fire light warmed toward amber.
- **Refinement round 2:**
  - **Eye:** larger (radius 0.028) and set in a wider socket. It now has a separate wet cornea shell (clear coat plus additive reflections) that carries the fire's catchlight. The iris texture now has branching red veins, iris fibres and crypts, and a dark limbal ring. The upper lid hides under the sculpted hood when the eye is open, so there is no longer a flat patch over it.
  - **Skin folds:** the forehead lines are softer and blurred so they no longer look like embossed cracks. The crepey body texture uses patchy Voronoi wrinkles instead of regular rings. New carved creases at the elbow and wrist, and sagging skin under the upper arm. The neck folds are carved into the head mesh.
  - **Hands:** rebuilt as bony hands. Each finger is three tapered phalanges with knobbly joints. Knuckles are smaller, fingers longer, and there are nails on the back of the fingertips and thin tendons across the back of the hand. The palm is flat and the wrist is no wider than the forearm. The meshes are finer, at about 3.6 mm voxels.
  - **Fire lighting:** at about 4 m the fire was clipping his skin to white, so it dropped from 330 to 225. The back-lit translucency term is now a faint red edge instead of a glow. A cooler, slightly stronger fill (hemisphere `#56607e`, 0.62) keeps the shadow side readable and cool against the warm key.
- **Half-moon eye (round 3):** the eye opening is now flat on top and round below, like the reference. A heavy, straight-edged upper lid (a rounded box added after the socket carve) hangs across the middle of the eyeball, with a fleshy fold above it. The socket is carved deeper below, and the eye's resting gaze is tipped up by 0.1 rad so the iris peers out from just under the lid with white curving beneath it. The red lower-lid cup is squashed into a thin wet waterline.
- Dev aid: `.claude/giant_portrait.js` frames his face in firelight for side-by-side comparisons (`await import('/.claude/giant_portrait.js'); giantShot(yaw, dist, height, fov)`).

## 5c. Cave scene polish pass (new art direction: muscled giant, armoured hero)

The giant's archetype changed from the gaunt elder to a massive, heavily muscled brute, after the sculpt reference. Odysseus follows the crested-hoplite archetype from the second reference: the costume type, not the actor. Final screenshots are in `screenshots/`.

- **Cyclops body** (`Anatomy.js` `giant` variant, now `brute`):
  - Body: broad shoulders (0.245), bulk 1.2, and musculature 1.6, with sloping traps, flared lats, serratus, capped deltoids, heavy forearms, quads, adductors, hamstrings, glutes, calves and broad feet.
  - Surface lines: the abdominal, linea alba and under-pec lines are carved into the real front surface, found by marching the distance field.
  - Neck: an upper-chest fill removes the ledge where the barrel chest met the neck.
  - Mesh: finer, at 8.5 mm voxels, with softer skin weights.
  - Removed: the gaunt extras (ribs, hump, crepey skin).
- **Cyclops head** (`GiantFace.js`):
  - Shape: a heavy brow ridge over the half-moon eye, a broad jaw with masseters, a square chin, a broad nose, full down-turned lips, a bull neck and a permanent scowl (anger 0.55).
  - Face maps: the painted wrinkles are reduced to a few scowl lines. They add skin-tone variation: flushed nose, cheeks and ears, and stubble shadow on the scalp and jaw.
  - The head is scaled 1.12 so he isn't pin-headed on the bigger frame.
- **Skin:** triplanar mapping in bind-pose object space for every character's skin. It replaces the cylindrical UVs that stretched over shoulders and scalps, especially at the giant's 4.4× scale. Pores are now a triplanar bump instead of a normal map.
- **Giant locomotion:**
  - Step rate now comes from stride length and ground speed.
  - The gait now has a real stance phase: each foot is planted for 60% of the cycle and sweeps back at a constant rate, then swings forward with a knee lift.
  - Measured: the planted foot moves 0.11 m/s against a body speed of 2.2 m/s (about 5%), down from about 45% slip.
  - The stance is heavy and grounded, with a weight shift onto each planted leg. The vulture neck is gone.
- **Odysseus:**
  - **Cape** (`Cape.js`): a real cloth simulation. It's a 9×13 Verlet grid pinned along the shoulders, with stretch, shear and bend constraints, gravity, drag and a gusting breeze. Sphere colliders on the shoulder blades, ribs, waist, hips, thighs, knees and shins stop it clipping. Soft pleats sit on top of the simulation, and it resets after teleports.
  - **Helmet:** a Corinthian helmet with a domed bowl, cheek guards and nasal framing the eyes, a neck guard and a rim. The tall horsehair crest is made of strand cards on a bronze holder.
  - **Armour:** weathered, darker bronze.
- **Cave, inside:**
  - Entrance: the tunnel bore is now 10.6 m (was 7.6) for an 8.2 m giant, with a round, wider dome cut and a double-sided bore. A floor runs through the bore, and the outside glow is a clean half-disc at the far end. The boulder is scaled up to match.
  - Prop audit: stalactites now hang from the real ceiling (found by raycast), and the columns run floor to ceiling. The hearth, racks, baskets, whetstone and staff are grounded on the uneven floor. The floating, upside-down bowl is now a carved bowl on the floor. The club leans against a rock column instead of on nothing. The fresco is painted on a rock slab set into the wall instead of floating 5 m in front of it. The fleece bed was six flat pale discs (the "cheese on the ground"); it's now seven ragged hides draped over the floor in mixed colours.
  - Set dressing: gnawed bones by the hearth and four wine jars.
  - Lighting: a warm, shadowless bounce light from the fire onto the vault, a cooler and stronger fill, a warm haze glowing round the hearth, and dust drifting through the firelight.
- **Cave mouth, outside:**
  - The floating ring of boulders is replaced by a cliff face that rises from the terrace to meet the hillside. The tunnel opening is cut with a smooth snapped edge, and a rough 30 m tunnel runs into the mountain.
  - The hillside rises steeply behind the mouth, and the terrain is cut where it would have ramped through the opening.
  - The giant stands in the doorway during the escape at z −59, inside the tunnel, with his head well clear.
- **Vegetation:**
  - Canopies: leaf-card foliage (alpha-cut cards over a soft core, with normals bent outward) replaces the faceted placeholder blobs, for olives and cypresses.
  - Placement: clustered groves and cypress stands; rocks bedded on their downhill side and tilted with the slope; grass in slope-aligned patches.
  - Exclusions: nothing grows on the path, the terrace or the cave mouth, near the landing or the altar, or on rocks or trunks.
- **Ship and water:**
  - Hull mask: the ocean discards fragments inside the hull outline, so there's no water inside the hull.
  - Calm water at the hull: waves within 7 m ease toward the ship's waterline, so crests can't climb over the gunwale.
  - Buoyancy: samples are spread along the hull, and pitch and roll are clamped to ±0.07 rad with slower settling (the roll was 0.16 rad).
  - Rowers: the capsule pawns are replaced by up to 12 real crew models seated on the benches, facing aft and rowing in time.
  - The ocean grid's rings are packed nearer the camera, so the wake foam no longer shows facets.
- *Verified:* no console errors across landing, cave, stealth, climax, escape, run, choice, sailing and title. Measured frame cost (CPU plus GPU, `gl.finish`): landing 4.5 ms, sailing 5.7, title 5.5, cave 7, stealth 5.9, climax 4.

## 5d. Sound stutter, flying greaves, figures with more depth

- **Audio stutter and lag** (`AudioEngine.js`, `Music.js`):
  - Every positional one-shot built an HRTF panner, the most expensive kind. With roughly 7 fire crackles a second plus steps and drips, the audio thread overloaded and glitched. One-shots now use equal-power panning; HRTF remains only on request and on the giant's voice.
  - Every one-shot chain is disconnected once its sound has died away.
  - A per-sound voice limiter sets a minimum gap and a cap within a time window (crackle, drip, step, giant step, hit and so on).
  - The audio context uses `latencyHint: 'balanced'` for a larger buffer.
  - Bus volumes are only written when they change, and glide there (no zipper clicks).
  - Music runs on its own 25 ms timer with 0.3 s lookahead (was the frame loop with 0.12 s). After a stall it skips the missed steps instead of firing them all at once, which was the audible "lag". The heartbeat is scheduled at its exact time.
  - *Measured in the cave:* the context runs steadily at about 6 one-shots a second, with the limiter trimming extras.
- **Odysseus's greaves flying around** (`Anatomy.js`): the hip-weight bias meant for skirts was applied to every garment, so the greaves (and bracers) followed the pelvis instead of the shins. The bias now applies only to the tunic and loincloth, and greaves and bracers get tighter weights to their own limb.
- **Figures with more depth:**
  - Lighting: wrap lighting is cut to about half, so forms turn into shadow, and the rim light is a thin edge rather than a cut-out glow.
  - Faces: a narrow nose bridge and defined tip, larger eyes set forward in smaller sockets with a bigger iris, relaxed eyelids (no startled stare), shaped lips with a philtrum, a mandible line, a zygomatic arch, nasolabial folds and mouth corners.
  - Hair: cards conform to the skull. Each strand is pushed onto a shell that stacks outward toward the tip, so there are no spikes, with more and narrower cards.
  - Beards: sculpted shells grown from the jaw, chin and moustache area, cut along the cheek line and open at the mouth, with fur shading and a fringe of cards under the chin. They replace the patchy alpha cards.
  - Tunics: a straighter chiton with short sleeves (no puffed shoulder balls), a neat round collar, a soft single chest, a higher hem and a leather girdle.
  - Body: fuller upper arms, forearms, knees and ankles; slightly glossier skin.
  - Idle pose: people at rest stand in a loose contrapposto, with weight on one leg, a soft knee, bent elbows and a slow sway.
- *Verified:* no console errors on landing, cave, stealth, climax, escape, run and choice, or on sailing and the title. Performance couldn't be re-measured cleanly because the app window was minimised and the GPU throttled. Ambient occlusion and a 2048 shadow map on Medium both looked costly there, so Medium keeps its previous 1024 shadows with AO off.

## 5e. Ongoing polish

- **Planted feet for everyone** (`Character.js`, `Player.js`, `Crew.js`): Odysseus and the crew now use the planted-stance gait too. Feet are planted for 62% of the cycle when walking, falling to 38% at a run (a flight phase), and the step rate comes from stride and ground speed (the stride shortens when crouched). There's a higher knee lift when running. *Measured:* the planted foot moves at 0.06 m/s against a walk of 2.13 m/s (3%), and at 0.19 m/s against a run of 4.73 m/s (4%).
- **Face colour** (`Anatomy.js` `faceColors`): regional colour is baked into each human head as vertex-colour multipliers on a face-only skin material: tinted lips, a soft flush on the nose, cheeks and ears, a little shadow under the eyes, and feathered eyebrows that taper away from the nose.
- **Giant attack poses** (`Cyclops.js`):
  - Raise: a two-handed overhead hammer blow with an arched back and loaded knees (was a one-armed wave).
  - Slam: deeper, with both fists down and the lead knee bent.
  - Roar: chest out, head back, arms out and forearms raised (was outstretched sleepwalker arms).
  - A roar expression (jaw wide, brow down, squint) is held while he roars or flails, and during scripted roars.
- *Verified:* no console errors on any chapter checkpoint or on sailing.
- **No skin poking through clothes** (`Anatomy.js`, `Character.js`):
  - Sleeves are wider and start inside the shoulder, so the deltoid no longer shows through.
  - The tunic shell has more margin over the torso (0.014).
  - The skirt is a little wider at the hips, so the outer thigh stays covered in the contrapposto stance.
  - Idle arms are held slightly out with less elbow bend, so the forearms clear the skirt.
  - The girdle sits on top of the cloth all round.
  - Calves are fuller, so the legs below the hem don't look spindly.

## 5f. Voice and sound stutter, stake grip, fleeing victims, touch controls

- **Voice stutter** (`GiantVoice.js`):
  - The giant's voice chain went through the one-shot output, whose 8-second cleanup could disconnect a long roar or speech line mid-sound. Each chain now lives as long as its utterance and uses HRTF placement.
  - Synthesized speech is legato: syllables flow into each other within a word, and plosives dip instead of hard-cutting to silence.
- **Sound stutter** (`AudioEngine.js`):
  - The listener position and orientation were scheduled with six `setTargetAtTime` events every frame and never cleared, so the audio thread's automation timeline grew without bound. They're now plain value writes.
  - Bus volume changes cancel stale automation before gliding.
- **Stake grip** (`CaveChapter.js`, `Character.js`): the 4.2 m stake was gripped at its middle, so half of it ran back through Odysseus. He now holds it ram-style, with the butt tucked at his right hip, the shaft running forward under his arm and the left hand forward on it, and a slight bob while moving.
- **Seized men run** (`CaveChapter.js`): a victim no longer stands with his hands up.
  - The chase: he bolts away from the giant (turned back into the open by the cave wall) while the giant runs him down at 5.2 m/s, re-targeting every half second. After 4.5 s the giant lunges regardless.
  - In the fist: his legs keep pumping and his arms flail, driven every frame because he has left the crew list.
- **Mobile controls** (`TouchControls.js`, `Input.js`, `style.css`):
  - Controls: a floating move stick wherever the left thumb lands, drag-to-look on the right half, and buttons for attack, dodge, shield/aim, interact, crouch, sprint (toggle), weapon and lock-on, plus pause.
  - Taps start the game and advance dialogue.
  - Pointer lock is skipped on touch devices, prompts show the button glyphs, the movement hint is touch-specific, and the viewport no longer zooms.
  - The controls only show during play.
  - *Tested in a 375×812 phone viewport:* the stick walks Odysseus, a look drag turns the camera, and the attack button presses and releases.
- *Verified:* no console errors on the cave, stealth, climax and escape checkpoints.

## 6. Still weak (next targets)
1. **Animation:** the bodies are now continuous and anatomical, but motion is still procedural keyframes, so locomotion and attacks look stiff next to the new models. Next: motion-matching-style blending and hand IK on ropes and weapons.
2. **Hands-on combat tuning:** every value is live in F6 and the logic is verified, but the "3 fights per input device" pass needs a human with a mouse and a gamepad.
3. **Headphone test of the giant:** the voice graph is built and plays without errors, but "does the first roar make you flinch" can only be judged by listening.
