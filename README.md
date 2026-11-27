# Morimens Gacha Calculator

Exact pull statistics for gacha banners with pity, soft pity, guarantees, memory
rules and item pools (`banners/`), and exact covenant substat rerolls (`covenant/`). The
site's root page sends you on to `banners/` (keeping old `#s=` share links working). Everything
runs in the browser (no backend), so it can be hosted on GitHub Pages.

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
| `src/components/` | UI: `PlanCard.jsx` and `AnswerCard.jsx` (the two cards, the same in both views), the banner plan tabs, goals and pity questions (simple view), plan rows and pity table (full view), chart, comparison, dialogs (Edit names, Banner rules, Settings) |
| `src/Site.jsx`, `src/components/SiteParts.jsx` | The calculators: which one is open (from the address), the header with the ☰ menu (calculators and language), background, footer. To add a calculator: an entry in `CALCULATORS`, a folder with an `index.html` (copy `covenant/`), its name and description under `site` in each language file, and the page in `vite.config.js` |
| `src/covenant/` | The covenant substat calculator: `rates.js` (the game's weights and costs), `engine.js` (exact rerolls and materials), `CovenantApp.jsx` (its page) |
| `index.html`, `banners/index.html`, `covenant/index.html` | The start page (sends you to `banners/`) and each calculator's own address (the same app, opened on that calculator) |
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
- Both views are one page: a plan card (banner plan switch, banner row, I want · Pity · Your
  pulls) and an answer card (This plan | Comparison, the answer, tiles, each banner plan, chart).
  The full view shows more inside the same cards (plan rows, pity table, its own tiles, the chart
  switch and Lines, tables); it never adds cards of its own. Settings (for every plan) open from
  the header; Banner rules and Import / Export from the full view's "⋯" menu.
- New plans start without pulls typed in: the answer is then how many pulls the goal takes.

## Several banners in one plan

A plan can have more than one banner plan: the "Banner plan 1 | Banner plan 2 | + Add banner plan"
tabs, the same in both views (`src/components/PlanTabs.jsx`). Each plan has one row: its banner, a
"?" with the banner's description and a "⋯" menu (Edit names, Reset this plan, Remove). Share, in
the header, is for the whole plan. Pulls are spent in one of two ways:

- **One budget** (default): pull on banner plan 1 until its goal is met, then banner plan 2 with
  what's left, and so on. The answer is the full distribution of the total number of pulls.
- **Each banner plan its own**: every plan gets its own pulls; the answer is the chance that every
  plan's goal is met with its pulls, and for each plan its chance, the pulls it takes on average and
  by when 9 in 10 are done (however many pulls it gets, given the plans before it were done), with a
  chart of each plan's chance by the pulls put into it.

Banners of the same type continue each other's pity and guarantees, exactly where the previous
banner left them when its goal was met (`src/engine/staged.js`, using the chain's end states). Which
built-in banners count as the same type is set in `PITY_TYPE` in `src/model.js` (the two Kaleido
banners share one type); other banners each are their own type, and custom banners never share.
Banner plan 1 is stored as the plan itself and the others in `stages`, so plans, links and
comparisons from before still open unchanged.

**Edit names** gives a plan a name of its own (`title`) and its own names for outcomes and items.
For a built-in banner they are kept as overrides (`names: { o: { path: name }, i: { path: [names] } }`,
see `applyNames` in `src/model.js`), so the banner stays that built-in banner: its pity still carries
over, links stay short, and the names you didn't change still follow the language.

In the simple view, a goal that counts more than one outcome ("any SSR", "any limited SSR", "different
characters") has a "?" that says what it counts, how often it comes up and its guarantee. The text is
written from the banner itself, so it fits custom banners and renamed ones too.

## Covenant substats

A covenant piece has 3 substat lines. A reroll draws every unlocked line again: its substat
(the 8 substats are equally likely on every piece today) and its level (Lv 1 to 8 at 23, 20,
17, 14, 11, 8, 5 and 2%). A substat's value is its level times its step (Crit. Rate 0.2% a
level, Keyflare Regen 0.3, and so on). The weights, steps and costs are in
`src/covenant/rates.js`, from the game client's config.

A reroll costs 7,500 Rose script and 3 seals, plus 1 quill with one locked line or 10 quills
with two (at most two). The calculator counts in quills, since a quill can be made into 20 seals
but not the other way round: a reroll costs 0.15, 1.15 or 10.15 quills.

The simple view gives the simple rule: lock a line
the moment it meets a goal and keep it locked (up to 2 lines), which is the best or close to it
for almost every goal. The full view adds every way of locking side by side (the cheapest one's
numbers on top) and the whole plan: what to lock in every situation a way can lead to, and the
rerolls left from there. The "?" by "Current substats" gives the odds, from `rates.js`.

`src/covenant/engine.js` works it out exactly. A line matters only through which goals it can
meet, so the state before a reroll is the 3 lines' goal masks (at most 120 states). Policy
iteration finds the locking choices with the fewest quills on average ("Cheapest") and the
fewest rerolls with up to 2, 1 or no locks ("lock as they come" is a fixed rule on the same chain); linear equations give the averages, and powers of
the transition matrix give the chance by reroll, so even goals that take millions of rerolls
are answered in milliseconds. Share links keep a covenant in `#c=…` (`src/covenant/share.js`:
"1", then 2 digits per line and goal, substat and level); short links (`/s/…`) work for every
calculator (`functions/api/share.js` keeps which one, `functions/s/[id].js` opens it).
`tests/covenant.test.js` checks it against answers worked out by
hand (a geometric wait, the three-Lv-8 Markov chain, and every one of the 64³ ways a reroll can
come out).
