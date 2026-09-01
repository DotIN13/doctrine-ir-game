# DOCTRINE

A browser game about realism in international relations — its **five feuding versions** — and the
three rival schools that want the field.

You run Meridia through eight situations. Five choices each, no right answers. Every choice is
scored against eight schools of thought, and at the end the game tells you which one you were
actually playing.

## Run it

It needs a web server, because the WebGL globe is an ES module (`file://` blocks those).

```bash
cd gamify-teach
python3 -m http.server 8731
# then open http://127.0.0.1:8731
```

Needs an internet connection on first load, for three.js and the fonts (both from CDN). Without
WebGL or without the CDN, the game detects it and still plays on a flat backdrop.

## The eight schools

Five kinds of realism, so the internal splits are first-class rather than a footnote:

| | School | The one-line version |
|---|---|---|
| Ω | Classical | People are grabby, so states are grabby. Manage it, don't fix it. |
| ⊘ | Defensive | Countries want to be safe, not huge. Grabbing too much gets you ganged up on. |
| ▲ | Offensive | You can count their tanks but never read their minds. So take all the power you can. |
| ⌗ | Neoclassical | The world pushes. Your parliament and budget decide whether you actually move. |
| ◈ | Hegemonic | One big country writes the rules. War comes when the growth lines cross. |

And the three challengers:

| | School | The one-line version |
|---|---|---|
| ⬡ | Liberalism | Nobody's in charge and cooperation still happens — if you change what cheating costs. |
| ✦ | Constructivism | Anarchy has no fixed meaning. Countries make it into what it becomes. |
| ✕ | Critical / Marxist | Ask who profits. "The national interest" usually belongs to somebody in particular. |

## How the teaching works

- **Each situation names one mechanism** — the security dilemma, the offence–defence balance,
  relative vs. absolute gains, underbalancing, norm cascades, power transition, audience costs,
  order-building — and forces you to act on it before it is explained.
- **Every choice gets a lesson card** naming the school that would applaud, in plain language.
- **Then a rival theorist objects**, and you have to pick the right rebuttal. Right answers are
  worth more Insight, but every answer explains itself.
- **The codex** holds all eight schools side by side, including a *what would prove it wrong* line
  for each. Reading those against each other is where the real disagreements live.

## Scoring

Affinity is a **share of what was on the table**, not a raw count: `affinity / (available + 3)`.

Schools are not offered equally often — Liberalism is the primary reading of eight options,
Classical Realism of three. Scoring raw points therefore diagnosed a consistently Morgenthau-ish
player as an *offensive* realist, because Offensive tended to be the co-scored option. Normalising
by availability fixes it; the `+3` pseudo-count stops one early choice from reading as "100%".

All eight schools are reachable as the dominant doctrine, with margins of 30–60 points if you play
toward one consistently.

## The map

The world is invented so nobody arrives with prior loyalties. It is also **authored, not random**:
each country is a set of discs at fixed coordinates (`js/world.js`), noise-perturbed in the shader
for organic coastlines. That guarantees labels always sit on their own country's land — a check the
verifier enforces. Unnamed fBm terrain fills the rest of the world.

## Performance

The 3D map was the whole frame budget. Measured in a headless Chromium with
software rendering (a deliberately harsh floor — a real GPU is far faster), full
game view at 1440x900:

| | avg frame |
|---|---|
| before | **388 ms** (2.6 fps) |
| after | **~31 ms** (frame-capped) |

Four things mattered, in order of size:

1. **Bloom was 85% of the frame.** `UnrealBloomPass` runs about eleven
   full-screen passes: 114 ms/frame with it, 17 ms without. Replaced with a
   three-pass bloom — bright-pass and downsample to a quarter, separable blur at
   that size, add back. The two blur passes now touch 1/16 of the pixels. This
   also dropped the three.js addon imports.
2. **The planet shader evaluated noise per country disc.** 15 discs x 2 fBm
   fields x 5 octaves x a sin-based hash was roughly 3,600 `sin` calls *per
   pixel per frame*. The fields never change, so they are baked once into an
   equirectangular texture (`bakeFields()`) and the per-frame shader is a single
   fetch. The bake still uses proper gradient noise — quality there is free.
3. **`acos` per disc, per pixel.** Gone: `cos`/`sin` of each disc radius come in
   as uniforms and the inside test is a dot-product compare, with the warped
   radius folded into the threshold to first order.
4. **Five `backdrop-filter` glass panels over an animating canvas**, which force
   the compositor to re-blur every frame, plus a full-screen `mix-blend-mode`
   layer that blends continuously even while invisible. Both removed; the glass
   was nearly opaque anyway.

Also: 34 fps frame cap (bypassed while dragging), canvas pixel ratio capped at
1.0 — all UI text is DOM, so only the soft globe is upscaled and nothing legible
blurs — lighter geometry, fewer stars, shared marker geometry, and disposal of
arc/marker buffers that previously leaked one set per situation.

`window.GLOBE.stats()` reports the current average frame time, quality tier and
pixel ratio. Quality degrades automatically after ~45 consistently slow frames
(4 tiers, down to 0.55x resolution with bloom off); `window.GLOBE.setQuality(0-3)`
forces a tier.

**Gotcha worth remembering:** `renderer.setSize(w, h, false)` skips the CSS
sizing, so at any pixel ratio below 1 the canvas displayed at its raw buffer
size instead of filling the viewport — which silently pushed every projected map
label out of register with the globe. The driver now asserts canvas CSS size
equals the viewport at every tier.

## Files

```
index.html         layout, import map for three.js
style.css          visual system
js/world.js        the invented geography
js/schools.js      the eight schools (codex content)
js/crises-a.js     situations 1–4
js/crises-b.js     situations 5–8
js/globe.js        WebGL map: territory shader, arcs, projected labels
js/game.js         game flow, scoring, HUD
```

## Notes for editing

- **Adding a country**: add to `js/world.js`. The shader holds 16 discs total (15 used).
- **Adding a situation**: match the shape in `js/crises-*.js`. `where` and `look` must be place ids
  from `world.js`; `teach.who` must be a school that the option also scores.
- **Text budgets** are deliberate — setup ≤ 45 words, option labels ≤ 16, outcomes ≤ 45, lessons
  ≤ 70. The first draft of this game was roughly three times longer and buried the map.
- **Don't make a caption's visibility depend on a CSS opacity transition.** One did, the transition
  could be left stuck on its first frame by a busy frame budget, and the result was a silent
  2.5-second blank pause instead of the animation beat. Visibility is a `display` toggle now, and
  the entrance animation only moves letter-spacing.
