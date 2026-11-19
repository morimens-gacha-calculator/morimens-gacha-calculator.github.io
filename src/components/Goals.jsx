import { allAlts, allNodes, altAt, itemNames, listOfInts, newId, nodeAt, num, parseChance, pathOf, reqLabel } from "../model.js";
import { useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import ItemPicker from "./ItemPicker.jsx";
import { HelpButton } from "./Help.jsx";
import { TrashIcon } from "./Icon.jsx";

// The simple view's parts of the plan card: the goals as sentences ("any character ×2 and
// Pontos's wheel ×1") and the pity as questions. They edit the same plan as the full view's rows
// and pity table, so switching views keeps everything.

// ── Goal lines ⇄ plan rows ──────────────────────────────────────────────────────────────
// A line's choice is "<path>|any", "<path>|item|<i>", "<path>|distinct" or "<path>|every";
// rows the sentence can't say (a chosen subset of items, an unusual target) show as "custom".
function goalChoices(banner, S) {
  const groups = [], other = [];
  for (const a of allAlts(banner)) {
    if (a.isPool) {
      const names = itemNames(a.alt);
      groups.push({
        label: a.name,
        options: [
          { value: `${a.key}|any`, label: S.anyOf(a.name) },
          { value: `${a.key}|distinct`, label: S.differentOf(a.name) },
          { value: `${a.key}|every`, label: S.everyOf(a.name, names.length) },
          ...names.map((nm, i) => ({ value: `${a.key}|item|${i}`, label: nm })),
        ],
      });
    } else if (a.isLeaf) {
      if (a.depth > 0) other.push({ value: `${a.key}|any`, label: a.name }); // e.g. "limited character"
    } else {
      other.push({ value: `${a.key}|any`, label: S.anyOf(a.name) }); // e.g. "any SSR"
    }
  }
  return { groups, other };
}

const poolSize = (banner, path) => {
  const a = allAlts(banner).find((x) => x.key === path);
  return a?.isPool ? itemNames(a.alt).length : 1;
};
// how many items a row counts: its chosen ones, or the whole pool
const countedSize = (banner, row) => (Array.isArray(row.items) && row.type !== "specific" ? row.items.length : poolSize(banner, row.path));

export function rowChoice(banner, row) {
  const a = allAlts(banner).find((x) => x.key === row.path);
  if (!a) return "custom";
  const subset = Array.isArray(row.items) && row.type !== "specific";
  if (a.isPool) {
    if (row.type === "total") return `${a.key}|any`;
    if (row.type === "specific") return `${a.key}|item|${row.item ?? 0}`;
    // "every" when picked as such; a goal picked as "different" stays so (every: false), even when
    // its number happens to match the items chosen; goals from the full view go by the numbers
    if (row.type === "distinct") return row.every !== false && row.k === countedSize(banner, row) ? `${a.key}|every` : `${a.key}|distinct`;
  }
  if (row.type === "total" && !subset && !(a.isLeaf && a.depth === 0)) return `${a.key}|any`;
  return "custom";
}

function applyChoice(banner, row, value) {
  const [path, kind, item] = value.split("|");
  // the chosen items stay when the outcome stays (any / different / every of the same pool)
  const items = path === row.path && kind !== "item" ? row.items ?? null : null;
  const n = Array.isArray(items) ? items.length : poolSize(banner, path);
  const base = { ...row, path, items, from: path === row.path ? row.from : "" };
  if (kind === "item") return { ...base, type: "specific", item: Number(item), from: path === row.path && row.type === "specific" && row.item === Number(item) ? row.from : "" };
  if (kind === "every") return { ...base, type: "distinct", k: n, every: true, from: "" };
  if (kind === "distinct") {
    const k = row.type === "distinct" && row.k < n ? row.k : Math.max(2, Math.min(3, n - 1));
    return { ...base, type: "distinct", k, every: false, from: "" };
  }
  return { ...base, type: "total", every: undefined };
}

// ── What a goal counts (the "?" beside a group or pool goal) ─────────────────────────────
// Written from the banner itself: the outcomes it takes in, how often it comes up among its
// parent's results, and its guarantee.
function shareOf(banner, key) {
  const path = pathOf(key);
  const parent = nodeAt(banner, path.slice(0, -1).join(","));
  const own = parseChance(altAt(banner, key).p);
  if (own !== "rest") return Number.isFinite(own) ? own : null;
  let sum = 0;
  for (const a of parent.alts) { const v = parseChance(a.p); if (v !== "rest" && Number.isFinite(v)) sum += v; }
  return Math.max(0, 1 - sum);
}
function explainGoal(banner, row, kind, T) {
  const S = T.simple, X = T.explain;
  // "50%", "3.03%": a chance read at a glance, not to the decimals of the results
  const pct = (p) => `${(p * 100).toLocaleString(T.numberLocale, { maximumFractionDigits: 2 })}%`;
  const a = allAlts(banner).find((x) => x.key === row.path);
  if (!a) return null;
  const group = !a.isLeaf;
  if (!group && (!a.isPool || kind === "item")) return null; // one outcome or item: it says what it is
  const lines = [];
  // how often, and the guarantee
  const p = shareOf(banner, a.key);
  if (p != null) lines.push(a.parentName ? X.rateIn(pct(p), a.parentName, a.name) : X.rateTop(pct(p), a.name));
  const pity = Math.floor(num(a.alt.pity));
  if (pity > 0) {
    if (!a.parentName) lines.push(X.pityTop(pity, a.name));
    else if (pity === 2) {
      // with one other outcome beside it, name it: "If the last SSR was standard SSR, the next one is always limited SSR."
      const others = nodeAt(banner, pathOf(a.key).slice(0, -1).join(",")).alts.filter((x) => x !== a.alt);
      lines.push(others.length === 1 ? X.pityAfter(others[0].name, a.parentName, a.name) : X.pityTwo(a.parentName, a.name));
    }
    else lines.push(X.pityIn(pity, a.parentName, a.name));
  }
  if (group) {
    const leaves = allAlts(banner).filter((x) => x.isLeaf && x.key.startsWith(`${a.key},`));
    const list = leaves.map((x) => (x.isPool ? X.poolAny(itemNames(x.alt).length, x.name) : x.name));
    return { what: S.anyOf(a.name), title: X.counts(S.anyOf(a.name)), list, lines };
  }
  const n = itemNames(a.alt).length;
  const chosen = Array.isArray(row.items) && row.type !== "specific" && row.items.length < n ? row.items.length : null;
  const what = kind === "distinct" ? S.differentOf(a.name).replace(/…$/, "") : kind === "every" ? S.everyOf(a.name, chosen ?? n) : S.anyOf(a.name);
  const first = kind === "distinct" ? [X.distinct(a.name)] : kind === "every" ? [X.every(chosen ?? n, a.name)] : [];
  return {
    what, title: kind === "any" ? X.counts(what) : X.heading(what), list: kind === "any" ? [X.poolAny(n, a.name)] : [],
    lines: [...first, ...(chosen != null ? [X.subset(chosen)] : []), X.poolEach(n, a.name), ...lines],
  };
}
function GoalHelp({ banner, row, kind }) {
  const T = useT();
  const info = explainGoal(banner, row, kind, T);
  if (!info) return null;
  return (
    <HelpButton label={T.explain.label(info.what)} text={(
      <span className="goal-help">
        <strong>{info.title}</strong>
        {info.list.length > 0 && <ul>{info.list.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        {info.lines.map((x, i) => <span key={i} className="goal-help-line">{x}</span>)}
      </span>
    )} />
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────
function GoalLine({ state, update, row, index, choices }) {
  const T = useT();
  const S = T.simple;
  const value = rowChoice(state.banner, row);
  const kind = value.split("|")[1];
  const n = countedSize(state.banner, row);
  const set = (fn) => update((s) => ({ ...s, goal: s.goal.map((r) => (r.id === row.id ? fn(r) : r)) }));
  const remove = () => update((s) => ({ ...s, goal: s.goal.filter((r) => r.id !== row.id) }));
  const alt = allAlts(state.banner).find((x) => x.key === row.path);
  const names = alt?.isPool ? itemNames(alt.alt) : [];
  const pool = names.length > 0 && kind !== "item";
  // choosing items keeps "every" meaning all of them, and "different" within what's chosen
  const pickItems = (items) => set((r) => {
    const size = Array.isArray(items) ? items.length : names.length;
    if (kind === "every") return { ...r, items, k: Math.max(1, size) };
    if (kind === "distinct") return { ...r, items }; // keep the number while items are being picked
    return { ...r, items };
  });
  // copies already owned, only where it reads plainly: one character (or one item) you collect
  // copies of. Copies set in the full view on other goals are named, with a way to clear them.
  const canOwn = kind === "item" || (kind === "any" && alt?.isLeaf && !alt.isPool);
  const ownedElsewhere = !canOwn && String(row.from ?? "").trim() !== "" && listOfInts(row.from).some((x) => x > 0);
  return (
    <div className="s-goal">
      {index > 0 && (
        index === 1 ? (
          <div className="s-join" role="group" aria-label={S.joinLabel}>
            {[["all", S.and], ["any", S.or]].map(([m, label]) => (
              <button key={m} type="button" aria-pressed={state.goalMode === m} className={state.goalMode === m ? "is-on" : ""}
                onClick={() => update((s) => ({ ...s, goalMode: m }))}>{label}</button>
            ))}
          </div>
        ) : <span className="s-join-word">{state.goalMode === "all" ? S.and : S.or}</span>
      )}
      <div className="s-goal-fields">
        <div className="s-what-cell">
        <select className="select s-field s-what" value={value} aria-label={S.whatLabel(index + 1)}
          onChange={(e) => set((r) => applyChoice(state.banner, r, e.target.value))}>
          {value === "custom" && <option value="custom" disabled>{reqLabel(state.banner, row)} ({S.customGoal})</option>}
          {choices.groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === `${row.path}|every` && Array.isArray(row.items) && row.type !== "specific" ? S.everyOf(g.label, row.items.length) : o.label}
                </option>
              ))}
            </optgroup>
          ))}
          {choices.other.length > 0 && (
            <optgroup label={S.otherGroup}>
              {choices.other.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          )}
        </select>
        {value !== "custom" && <GoalHelp banner={state.banner} row={row} kind={kind} />}
        </div>
        {/* each piece in its own shared column, so "×", the numbers and "each" line up on every row */}
        <span className="s-times" aria-hidden="true">×</span>
        <NumberInput className="custom-input s-field s-num s-copies-num" min={1} max={999} value={row.copies}
          onChange={(v) => set((r) => ({ ...r, copies: v }))} aria-label={S.copiesLabel} />
        {(kind === "distinct" || kind === "every") && <span className="s-each">{S.each}</span>}
        {state.goal.length > 1 && (
          <button type="button" className="s-remove" onClick={remove} aria-label={S.removeGoal} title={S.removeGoal}><TrashIcon /></button>
        )}
      </div>
      {/* the line under the goal: "3 different from [3 chosen]", or "from [All 19]" */}
      {pool && (
        <div className="s-inline s-from">
          {kind === "distinct" && (
            <label className="s-inline">
              <NumberInput className="custom-input s-field s-num" min={1} max={n} value={row.k}
                onChange={(v) => set((r) => ({ ...r, k: v }))} aria-label={S.howManyDifferent} />
              <span>{S.different}</span>
            </label>
          )}
          <span>{S.fromLabel}</span>
          <ItemPicker names={names} value={Array.isArray(row.items) && row.items.length < names.length ? row.items : null} onChange={pickItems} />
        </div>
      )}
      {canOwn && (
        <div className="s-inline s-have">
          <label className="s-inline">
            <span>{S.alreadyHave}</span>
            <NumberInput className="custom-input s-field s-num" min={0} max={998} value={Math.floor(num(row.from, 0))}
              onChange={(v) => set((r) => ({ ...r, from: v ? String(v) : "" }))} aria-label={S.alreadyHave} />
          </label>
          <HelpButton label={S.alreadyHave} text={S.ownHelp} />
        </div>
      )}
      {ownedElsewhere && (
        <div className="s-inline s-have s-owned-note">
          <span>{S.ownedElsewhere}</span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => set((r) => ({ ...r, from: "" }))}>{S.clearOwned}</button>
        </div>
      )}
    </div>
  );
}

// Pity and memory as questions: "Pulls since my last SSR", "My last SSR was a character, twice in a row"
export function StartQuestions({ state, update }) {
  const S = useT().simple;
  const pityAlts = allAlts(state.banner).filter((a) => num(a.alt.pity) > 0);
  const streakNodes = allNodes(state.banner).filter((n) => n.node.streak > 0);
  const setPity = (key, v) => update((s) => ({ ...s, start: { ...s.start, pity: { ...s.start.pity, [key]: v } } }));
  const setStreak = (key, v) => update((s) => {
    const [i, r] = v === "" ? [0, 0] : v.split(":").map(Number);
    return { ...s, start: { ...s.start, streak: { ...s.start.streak, [key]: [i, r] } } };
  });
  return (
    <>
      {/* pity asked the way it counts: pulls at the top level ("Pulls since my last SSR"); results of
          the outcome above it for nested ones ("SSRs since my last limited wheel"), and a yes/no
          question when one miss already guarantees it (pity 2: "Is my next SSR a guaranteed …?") */}
      {pityAlts.map((a) => {
        const pity = num(a.alt.pity);
        const value = state.start.pity[a.key] ?? 0;
        if (a.parentName === null) return (
          <div key={a.key} className="s-row">
            <label className="s-row-label">
              <span>{S.sinceLast(a.name)}</span>
              <NumberInput className="custom-input s-field s-num" min={0} max={Math.max(0, pity - 1)} value={value} onChange={(v) => setPity(a.key, v)} />
            </label>
            <HelpButton label={S.sinceLast(a.name)} text={S.pityHint} />
          </div>
        );
        // these questions are long: question, answer, "?" on one row like the others; when space runs out only the question text wraps
        const id = `pity-${a.key.replace(/\W/g, "-")}`;
        if (pity === 2) return (
          <div key={a.key} className="s-row s-row--stack">
            <span className="s-q" id={id}>{S.guaranteedNext(a.parentName, a.name)}</span>
            <span className="seg seg--sm" role="group" aria-labelledby={id}>
              {[[1, S.guaranteedYes], [0, S.guaranteedNo]].map(([v, label]) => (
                <button key={v} type="button" aria-pressed={(value > 0 ? 1 : 0) === v} className={(value > 0 ? 1 : 0) === v ? "is-on" : ""}
                  onClick={() => setPity(a.key, v)}>{label}</button>
              ))}
            </span>
            <HelpButton label={S.guaranteedNext(a.parentName, a.name)} text={S.guaranteedHelp(a.parentName, a.name)} />
          </div>
        );
        return (
          <div key={a.key} className="s-row s-row--stack">
            <label className="s-q" htmlFor={id}>{S.sinceLastResult(a.parentName, a.name)}</label>
            <NumberInput id={id} className="custom-input s-field s-num" min={0} max={pity - 1} value={value} onChange={(v) => setPity(a.key, v)} />
            <HelpButton label={S.sinceLastResult(a.parentName, a.name)} text={S.sinceLastResultHelp(a.parentName, a.name, pity)} />
          </div>
        );
      })}
      {streakNodes.map((n) => {
        const cur = state.start.streak[n.key] ?? [0, 0];
        const value = cur[1] > 0 ? `${cur[0]}:${Math.min(cur[1], n.node.streak)}` : "";
        return (
          <label key={n.key} className="s-row">
            <span>{S.lastWas(n.name)}</span>
            <select className="select s-field" value={value} onChange={(e) => setStreak(n.key, e.target.value)}>
              <option value="">{S.dontKnow}</option>
              {n.node.alts.flatMap((a, i) => Array.from({ length: n.node.streak }, (_, r) => (
                <option key={`${i}:${r + 1}`} value={`${i}:${r + 1}`}>{r === 0 ? a.name : S.inARow(a.name, r + 1)}</option>
              )))}
            </select>
          </label>
        );
      })}
    </>
  );
}

// The simple view's "I want": its goals as lines, and "+ Add another goal"
export function Goals({ state, update }) {
  const S = useT().simple;
  const choices = goalChoices(state.banner, S);
  const addGoal = () => update((s) => {
    const first = choices.groups[0]?.options[0]?.value ?? choices.other[0]?.value;
    const blank = { id: newId(), path: "0", type: "total", item: 0, k: 1, copies: 1, from: "" };
    return { ...s, goal: [...s.goal, first ? applyChoice(s.banner, blank, first) : blank] };
  });
  return (
    <>
      <div className="s-goals">
        <div className="s-goal-head" aria-hidden="true"><span>{S.colWhat}</span><span>{S.colHowMany}</span></div>
        {state.goal.map((row, i) => (
          <GoalLine key={row.id} state={state} update={update} row={row} index={i} choices={choices} />
        ))}
      </div>
      <button type="button" className="btn btn--quiet btn--sm s-add" onClick={addGoal}>+ {S.addGoal}</button>
    </>
  );
}

// First visit: a few questions to try on the current banner
export function examplesFor(banner, S) {
  const alts = allAlts(banner);
  const pool = alts.find((a) => a.isPool);
  // "Will I get X?": a featured outcome of its own (a limited character), else a named pool item
  const single = alts.find((a) => a.isLeaf && !a.isPool && a.depth > 0);
  const named = alts.find((a) => a.isPool && String(a.alt.items ?? "").trim());
  const row = (path, extra) => ({ id: newId(), path, item: 0, k: 1, copies: 1, from: "", type: "total", ...extra });
  const out = [];
  if (single) out.push({ label: S.exSpecific(single.name, 100), goal: [row(single.key)], mode: "budget", budget: 100 });
  else if (named) out.push({ label: S.exSpecific(itemNames(named.alt)[0], 100), goal: [row(named.key, { type: "specific" })], mode: "budget", budget: 100 });
  if (pool) {
    const n = itemNames(pool.alt).length, k = Math.min(3, n);
    out.push({ label: S.exDifferent(k, pool.name, 200), goal: [row(pool.key, { type: "distinct", k })], mode: "budget", budget: 200 });
    out.push({ label: S.exEvery(n, pool.name), goal: [row(pool.key, { type: "distinct", k: n })], mode: "pulls" });
  }
  return out;
}
