# Morimens Gacha Calculator

Exact pull statistics for gacha banners with pity, soft pity, guarantees, memory
rules and item pools. Everything runs in the browser (no backend), so it can be
hosted on GitHub Pages.

## Run locally

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # production build in dist/

## Tests

    npm test

Checks that the engine stays exact: hand-computable answers, the built-in banners' results,
the pool formulas against a slow state-by-state calculation (fixed and random goals), the three
calculation methods against each other, item subsets against the same goal written out by
hand, the WebAssembly and multi-thread stepping, and that every translation has all keys.
Takes about 15 seconds. GitHub Actions runs it before every deploy (nothing is published if a
test fails) and on pull requests.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (branch `main`).
2. In the repository: Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` builds and publishes the site
   (`.github/workflows/deploy.yml`). The build uses relative paths, so it works
   at `https://<user>.github.io/<repo>/` without extra configuration.

## Where things are

| File | What it does |
|---|---|
| `src/engine/banner-engine.js` | The engine's interface: `solve`, `budgetOnly`, and which method to use |
| `src/engine/tree.js`, `goal.js` | Reading the banner tree and the goal rows (item subsets, labels) |
| `src/engine/chain.js` | Building the state chain of a banner and goal; exact worst case |
| `src/engine/joint.js`, `split.js`, `layered.js` | The three exact methods (see the top of each file) |
| `src/engine/pool-formulas.js`, `pools.js` | Exact formulas for which items a pool gives |
| `src/engine/renewal.js` | FFT and "SSRs by pull" helpers of the layered method |
| `src/engine/renewal-matrix.js` | The same for banners whose counters keep running through SSRs (matrices of gaps) |
| `src/engine/worst.js` | Exact worst case ("guaranteed by") for every method |
| `src/engine/chain-step.js`, `step-thread*.js`, `*.wat` | Fast chain stepping (WebAssembly, several cores). After editing a `.wat` file, run `npm run build:wasm` (it regenerates `wasm-kernels.js`; `npm test` fails if you forget) |
| `src/engine/cache.js` | Reusing pieces between calculations |
| `src/engine/settings.js` | Every accuracy setting, limit and speed trade-off, with the reason for its value |
| `src/engine/engine.worker.js` | Runs the engine in a Web Worker |
| `tests/` | Engine tests (`npm test`) |
| `src/useEngine.js` | React hook: debounced, cancellable calls to the worker |
| `src/model.js` | Editor model ↔ engine format, presets, building queries |
| `src/share.js` | Shareable links (the setup packed after `#s=`) |
| `src/export.js` | CSV and chart image downloads |
| `src/components/` | UI: preset nav, setup card (pity / banner rules / settings), pull plan, question, chart, stats, tables |
| `src/styles.css` | All styling (colour tokens at the top) |
| `src/i18n/en.js` | Every piece of interface text |
| `src/site.config.js` | Background images (one per view), default preset, and the footer's site name, banner patch version and "Source code" link (`SOURCE_URL`) |

To add a banner preset, add an entry to `presets()` in `src/model.js` and its title, hint
and names under `presets` in each language file. "Custom banner" in the dropdown is the
player's own banner: it starts from `customTemplate()` in `src/model.js` and is remembered
in the browser separately from the presets. The Kaleido banners' character lists are under
`presets.kaleido1.characters` / `kaleido2.characters` in the language file.

## Translating the site

The site ships in English (`en.js`), Russian (`ru.js`) and Ukrainian (`ua.js`, language
code `uk`). A first-time visitor gets their browser's language if it is one of these; the
picker in the header switches it. `node scripts/check-i18n.mjs` checks that every language
has exactly the same keys as English.

To add another language:

1. Copy `src/i18n/en.js` to a new file, e.g. `src/i18n/uk.js`.
2. Translate the values; keep the keys. Entries that are functions build sentences with
   numbers in them (`(n) => ...`), so you can apply your language's plural rules there.
   Set `numberLocale` (e.g. `"uk-UA"`) so numbers are formatted the local way.
3. In `src/i18n/index.js`, import it and add it to `LOCALES`:
   `export const LOCALES = { en, uk };`
4. A language picker appears in the header as soon as there are two or more languages.
   The choice is remembered in the browser.

Error messages from the calculation engine itself (`src/engine/banner-engine.js`) are
technical and stay in English; everything a player normally sees is in the language file.

## Changing the backgrounds

The simple view and the full view each have their own background, set in `BACKGROUNDS` in
`src/site.config.js`. Both use the same images until you change one.

1. Put your image in `src/assets/` (any web format: .webp, .jpg, .png, .avif).
2. In `src/site.config.js`, import it and use it as `desktop` under `simple` or `full`.
   `mobile` is used on narrow screens; leave it out to reuse the desktop image.
3. Optional: `position`, `size` and `fixed` control how it is placed; `desktop: null`
   turns the image off for that view.
4. `fade` is the tint over the image that keeps text readable, e.g.
   `"rgba(35, 38, 56, 0.5)"`; `null` uses the default `--bg-fade` in `src/styles.css`.

`scripts/make_bg.py` regenerates the default starfield image if you want to tweak it.

## Design

The look is set by colour tokens at the top of `src/styles.css` (the "Glacier" palette) and by
one block of shared component styles at the end of the same file. A few rules keep it consistent:

- Flat colour only: no gradients, glows or shadows.
- `--action` (ice blue) is only for things you can press; `--gold` is only for the answer (the
  chance, the average and the average line on the chart); `--data` and `--s1`…`--s6` are only for
  chart lines.
- Buttons come in four levels: `.btn--primary` (filled, one per card), `.btn--secondary`,
  `.btn--quiet` (text only) and icon buttons. One-of-a-few choices use the segmented switch.
- Fonts are served by the site itself (`src/main.jsx`): Inter for everything, JetBrains Mono for the
  banner data editor.
