# Banner Pull Calculator

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
| `src/engine/chain-step.js`, `step-thread*.js`, `*.wat` | Fast chain stepping (WebAssembly, several cores) |
| `src/engine/cache.js` | Reusing pieces between calculations |
| `src/engine/settings.js` | Every accuracy setting, limit and speed trade-off, with the reason for its value |
| `src/engine/engine.worker.js` | Runs the engine in a Web Worker |
| `tests/` | Engine tests (`npm test`) |
| `src/useEngine.js` | React hook: debounced, cancellable calls to the worker |
| `src/model.js` | Editor model ↔ engine format, presets, building queries |
| `src/components/` | UI: preset nav, setup card (pity / banner rules / settings), pull plan, question, chart, stats, tables |
| `src/styles.css` | All styling (colour tokens for both themes at the top) |
| `src/i18n/en.js` | Every piece of interface text |
| `src/site.config.js` | Background image, default theme, default preset, and the footer's site name, banner patch version and "Source code" link (`SOURCE_URL`) |

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

## Changing the background

1. Put your image in `src/assets/` (any web format: .webp, .jpg, .png, .avif).
2. In `src/site.config.js`, change the `desktop` import to your file. `mobile` is used on
   narrow screens; point it at the same file if you only have one size.
3. Optional: `position`, `size` and `fixed` control how it is placed. `desktop: null`
   turns the image off.
4. How strongly it shows through is the `--bg-fade` tint in `src/styles.css` (one value for
   the dark theme, one for the light theme).

`scripts/make_bg.py` regenerates the default starfield image if you want to tweak it.
