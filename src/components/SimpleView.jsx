import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { allAlts, allNodes, fmtInt, fmtPct, itemNames, listOfInts, newId, num, reqLabel } from "../model.js";
import { errorText, useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import Progress from "./Progress.jsx";
import ResultChart, { sample, themeColors } from "./ResultChart.jsx";
import ItemPicker from "./ItemPicker.jsx";
import { HelpButton } from "./Help.jsx";
import { TrashIcon } from "./Icon.jsx";
import { CompareExport } from "./ComparePanel.jsx";

// The simple view: the plan as a sentence ("I want any character ×2 and Pontos's wheel ×1, I
// have 300 pulls…") and the answer in words, with one chart. It edits the same setup as the full
// view (plan rows, pity, budget), so switching views keeps everything.

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

// How a goal reads in the simple view: "any character ×2" where the full view says "character ×2"
function goalText(banner, row, S) {
  const choice = rowChoice(banner, row);
  if (choice.endsWith("|any")) {
    const a = allAlts(banner).find((x) => x.key === row.path);
    if (a && !a.isLeaf) return `${S.anyOf(a.name)} ×${row.copies}`;
    if (a?.isPool) return `${S.anyOf(a.name)} ×${row.copies}`;
  }
  return reqLabel(banner, row);
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
function StartQuestions({ state, update }) {
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

// The first pull with at least chance p, from the distribution
function quantile(r, p) {
  for (let i = 0; i < r.cdf.length; i++) if (r.cdf[i] >= p - 1e-12) return i;
  return null;
}

// A sentence with its key number set off: the template is filled with a marker, then split around it.
// The value itself goes along as the second argument, so the words around it can agree with it.
const MARK = "\u0001";
function highlight(template, value) {
  const [before, after = ""] = template(MARK, value).split(MARK);
  return <>{before}<strong className="s-hl">{value}</strong>{after}</>;
}

function Answer({ state, update, engine, theme, onCompare, onDetails, isSaved, compare, tab, setTab }) {
  const T = useT();
  const S = T.simple;
  const r = engine.result;
  const budgetMode = state.mode === "budget";
  const settings = state.settings;
  const goals = state.goal.map((g) => goalText(state.banner, g, S)).join(state.goalMode === "all" ? ` ${S.and} ` : ` ${S.or} `);
  if (engine.status === "error") {
    return <section className="s-card s-answer" aria-label={S.answerLabel}><p className="error-box" role="alert">{errorText(T, engine)}</p></section>;
  }
  if (!r) return <section className="s-card s-answer" aria-label={S.answerLabel}><Progress engine={engine} /></section>;
  const half = quantile(r, 0.5), nine = quantile(r, 0.9);
  const chance = r.budget?.chanceGoal;
  const actions = (
    <>
      <button type="button" className="btn btn--primary" onClick={onCompare} disabled={isSaved}>{isSaved ? S.inCompare : S.compare}</button>
      <button type="button" className="btn btn--secondary" onClick={onDetails}>{S.details}</button>
    </>
  );
  const showBest = settings.showBest !== false && r.min != null && r.min > 0;
  const showWorst = settings.showWorst !== false && r.maxKnown !== false;
  const stats = [
    half != null && [S.statHalf, fmtInt(half)],
    nine != null && [S.statNine, fmtInt(nine)],
    showBest && [S.statEarliest, fmtInt(r.min)],
    showWorst && (r.max != null ? [S.statGuaranteed, fmtInt(r.max)] : [S.statGuarantee, S.statNone]),
  ].filter(Boolean);
  return (
    <section className={`s-card s-answer ${engine.status === "busy" ? "is-updating" : ""}`} aria-label={S.answerLabel} aria-busy={engine.status === "busy"}>
      {/* first, the switch between this plan and the comparison; each tab has its own numbers and chart */}
      {compare.items.length > 0 && (
        <div className="seg s-chart-tabs" role="tablist" aria-label={S.chartTabs}>
          <button type="button" role="tab" aria-selected={tab === "plan"} className={tab === "plan" ? "is-on" : ""} onClick={() => setTab("plan")}>{S.tabPlan}</button>
          <button type="button" role="tab" aria-selected={tab === "compare"} className={tab === "compare" ? "is-on" : ""} onClick={() => setTab("compare")}>
            {S.compareTitle} <span className="count">{compare.items.length}</span>
          </button>
        </div>
      )}
      {engine.status === "busy" && <Progress engine={engine} compact />}
      {tab === "compare" && compare.items.length > 0 ? (
        <SimpleCompare {...compare} load={(it) => { compare.load(it); setTab("plan"); }} theme={theme} settings={settings} current={isSaved ? null : r}>{actions}</SimpleCompare>
      ) : (
        <>
          <p className="s-context">{budgetMode ? S.contextBudget(goals, fmtInt(state.budget)) : S.contextPulls(goals)}</p>
          {budgetMode && chance != null ? (
            <>
              <p className="s-big">{highlight(S.youHave, fmtPct(chance))}</p>
              <p className="s-second">{highlight(S.averageBig, fmtInt(r.mean))}</p>
            </>
          ) : (
            <p className="s-big">{highlight(S.averageBig, fmtInt(r.mean))}</p>
          )}
          {!budgetMode && (
            <p className="s-sure">
              <span>{S.toBeSure}</span>
              <NumberInput className="custom-input s-field s-num" integer={false} min={1} max={99.99} value={state.desired}
                onChange={(v) => update((s) => ({ ...s, desired: v }))} aria-label={S.sureLabel} />
              <span>{highlight(S.sureResult, r.requiredPulls != null ? fmtInt(r.requiredPulls) : "-")}</span>
            </p>
          )}
          {stats.length > 0 && (
            <dl className="s-stats">
              {stats.map(([label, value]) => (
                <div key={label} className="s-stat"><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          )}
          {budgetMode && r.min != null && state.budget < r.min && <p className="note-box" role="status">{T.target.notPossible(fmtInt(r.min))}</p>}
          <ResultChart state={state} update={update} engine={engine} theme={theme} simple>{actions}</ResultChart>
        </>
      )}
    </section>
  );
}

// First visit: a few questions to try on the current banner
function examplesFor(banner, S) {
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

export default function SimpleView({ state, update, engine, theme, firstVisit, onExampleDone, onCompare, onDetails, compare, isSaved }) {
  const T = useT();
  const S = T.simple;
  const choices = goalChoices(state.banner, S);
  const examples = firstVisit ? examplesFor(state.banner, S) : [];
  // the pulls field: empty = "how many do I need" (pulls mode), a number = "do I have enough"
  const [pullsText, setPullsText] = useState(state.mode === "budget" ? String(state.budget) : "");
  useEffect(() => { setPullsText(state.mode === "budget" ? String(state.budget) : ""); }, [state.mode, state.budget]);
  const onPulls = (text) => {
    setPullsText(text);
    if (text.trim() === "") { update((s) => ({ ...s, mode: "pulls" })); return; }
    const v = Math.floor(Number(text));
    if (Number.isFinite(v) && v >= 0) update((s) => ({ ...s, mode: "budget", budget: v }));
  };
  const addGoal = () => update((s) => {
    const first = choices.groups[0]?.options[0]?.value ?? choices.other[0]?.value;
    const blank = { id: newId(), path: "0", type: "total", item: 0, k: 1, copies: 1, from: "" };
    return { ...s, goal: [...s.goal, first ? applyChoice(s.banner, blank, first) : blank] };
  });
  // the answer's chart: this plan, or the comparison (shown after adding a plan to it)
  const [tab, setTab] = useState("plan");
  useEffect(() => { if (!compare.items.length) setTab("plan"); }, [compare.items.length]);
  const pick = (ex) => {
    update((s) => ({ ...s, goal: ex.goal, goalMode: "all", mode: ex.mode, budget: ex.budget ?? s.budget }));
    onExampleDone();
  };

  return (
    <div className="simple-layout">
      <section className="s-card s-plan" aria-label={S.planLabel}>
        {examples.length > 0 && (
          <div className="s-examples">
            <p className="s-examples-title">{S.tryOne}</p>
            {examples.map((ex) => <button key={ex.label} type="button" className="s-example" onClick={() => pick(ex)}>{ex.label}</button>)}
            <button type="button" className="btn btn--link" onClick={onExampleDone}>{S.ownQuestion}</button>
          </div>
        )}
        <h2 className="s-lead">{S.iWant}</h2>
        <div className="s-goals">
          <div className="s-goal-head" aria-hidden="true"><span>{S.colWhat}</span><span>{S.colHowMany}</span></div>
          {state.goal.map((row, i) => (
            <GoalLine key={row.id} state={state} update={update} row={row} index={i} choices={choices} />
          ))}
        </div>
        <button type="button" className="btn btn--quiet btn--sm s-add" onClick={addGoal}>+ {S.addGoal}</button>
        <div className="s-divider" />
        <div className="s-row">
          <label className="s-row-label">
            <span>{S.iHave}</span>
            <input type="number" inputMode="numeric" min={0} className="custom-input s-field s-num s-pulls" value={pullsText}
              placeholder="?" onChange={(e) => onPulls(e.target.value)} />
            <span>{S.pulls}</span>
          </label>
          <HelpButton label={S.iHave} text={S.pullsHelp} />
        </div>
        <StartQuestions state={state} update={update} />
      </section>
      <div className="s-side">
        <Answer state={state} update={update} engine={engine} theme={theme} onDetails={onDetails} isSaved={isSaved}
          compare={compare} tab={tab} setTab={setTab} onCompare={() => { onCompare(); setTab("compare"); }} />
      </div>
    </div>
  );
}

// The comparison, kept in the simple view: every saved plan's chance curve on one chart (and this
// plan as a dashed line while it isn't saved), a short list (average, 9 in 10) with Open and Remove
function SimpleCompare({ items, results, budget, setBudget, remove, load, theme, settings, current, children }) {
  const T = useT();
  const S = T.simple;
  const chartRef = useRef(null);
  const rows = items.map((it, i) => {
    const res = results[it.id];
    const r = res?.status === "ok" ? res.result : null;
    const chance = r ? (budget < r.cdf.length ? r.cdf[budget] : 1 - r.tail) : null;
    return { it, i, res, r, chance };
  });
  const ready = rows.filter((x) => x.r);
  const means = [...ready.map((x) => x.r.mean), ...(current ? [current.mean] : [])];
  const at = (r) => (budget < r.cdf.length ? r.cdf[budget] : 1 - r.tail);
  const chances = [...ready.map((x) => at(x.r)), ...(current ? [at(current)] : [])];
  const bestChance = budget > 0 && chances.length > 1 ? Math.max(...chances) : null;
  const bestMean = means.length > 1 ? Math.min(...means) : null;
  const chart = useMemo(() => {
    if (!ready.length && !current) return null;
    const C = themeColors();
    let xMax = 10;
    for (const r of [...ready.map((x) => x.r), ...(current ? [current] : [])]) {
      let x = r.cdf.length - 1;
      for (let t = 0; t < r.cdf.length; t++) if (r.cdf[t] >= 0.999) { x = t; break; }
      xMax = Math.max(xMax, x);
    }
    const datasets = ready.map(({ it, r, i }) => ({
      label: it.name, data: sample(r.cdf, xMax), borderColor: C.series[i % C.series.length],
      backgroundColor: C.series[i % C.series.length], borderWidth: 2, pointRadius: 0, borderDash: i >= C.series.length ? [6, 4] : [],
    }));
    if (current) datasets.push({ label: S.cmpCurrent, data: sample(current.cdf, xMax), borderColor: C.marker, backgroundColor: C.marker, borderWidth: 2, pointRadius: 0, borderDash: [5, 4] });
    return { C, xMax: Math.max(xMax, budget || 0), datasets };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, items, current, budget, theme, T]);

  return (
    <div className="s-compare">
      <label className="s-inline s-cmp-at">
        <span>{S.cmpMark}</span>
        <NumberInput className="custom-input s-field s-pulls" min={0} value={budget} onChange={setBudget} aria-label={S.cmpMark} />
      </label>
      {chart && (
        <div className="chart-container s-compare-chart">
          <Line
            ref={chartRef}
            data={{ datasets: chart.datasets }}
            options={{
              responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
              interaction: { mode: "index", intersect: false },
              scales: {
                x: { type: "linear", min: 0, max: chart.xMax, title: { display: true, text: T.chart.xTitle, color: chart.C.tick }, ticks: { color: chart.C.tick, callback: (v) => fmtInt(v), maxTicksLimit: 8 }, grid: { color: chart.C.grid }, border: { color: chart.C.grid } },
                y: { min: 0, max: 1, ticks: { color: chart.C.tick, callback: (v) => `${Math.round(v * 100)}%`, maxTicksLimit: 6 }, grid: { color: chart.C.grid }, border: { color: chart.C.grid } },
              },
              plugins: {
                legend: { display: false },
                tooltip: { callbacks: { title: (it) => T.chart.pull(fmtInt(it[0]?.parsed.x)), label: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.y)}` } },
                markers: { items: budget > 0 ? [{ x: budget, strong: true, color: chart.C.marker, bg: chart.C.inset, label: S.cmpLine(fmtInt(budget)) }] : [] },
              },
            }}
          />
        </div>
      )}
      {items.length === 1 && !current && <p className="s-hint">{S.compareOne}</p>}
      <div className="s-cmp" role="table" aria-label={S.compareTitle}>
        <div className="s-cmp-row s-cmp-head" role="row">
          <span role="columnheader">{S.cmpPlan}</span>
          <span role="columnheader" className="s-cmp-num">{S.cmpAverage}</span>
          <span role="columnheader" className="s-cmp-num">{S.cmpNine}</span>
          <span role="columnheader" className="s-cmp-num">{S.cmpChance(fmtInt(budget))}</span>
          <span role="columnheader"><span className="sr-only">{T.compare.actions}</span></span>
        </div>
        {current && (
          <div className="s-cmp-row is-current" role="row">
            <span className="s-cmp-name" role="cell"><span className="swatch swatch--dashed" aria-hidden="true" /><span>{S.cmpCurrent}</span></span>
            <span role="cell" className={`s-cmp-num ${current.mean === bestMean ? "is-best" : ""}`}><span className="s-cmp-label">{S.cmpAverage}</span>{fmtInt(current.mean)}</span>
            <span role="cell" className="s-cmp-num"><span className="s-cmp-label">{S.cmpNine}</span>{current.percentiles?.p90 != null ? fmtInt(current.percentiles.p90) : "-"}</span>
            <span role="cell" className={`s-cmp-num ${at(current) === bestChance ? "is-best" : ""}`}><span className="s-cmp-label">{S.cmpChance(fmtInt(budget))}</span>{fmtPct(at(current))}</span>
            <span role="cell" className="s-cmp-actions s-cmp-note">{S.cmpNotAdded}</span>
          </div>
        )}
        {rows.map(({ it, i, res, r }) => (
          <div key={it.id} className="s-cmp-row" role="row">
            <span className="s-cmp-name" role="cell">
              <span className="swatch" style={{ "--c": `var(--s${(i % 6) + 1})` }} aria-hidden="true" />
              <span title={it.name}>{it.name}</span>
            </span>
            {r ? (
              <>
                <span role="cell" className={`s-cmp-num ${r.mean === bestMean ? "is-best" : ""}`}><span className="s-cmp-label">{S.cmpAverage}</span>{fmtInt(r.mean)}</span>
                <span role="cell" className="s-cmp-num"><span className="s-cmp-label">{S.cmpNine}</span>{r.percentiles.p90 != null ? fmtInt(r.percentiles.p90) : "-"}</span>
                <span role="cell" className={`s-cmp-num ${at(r) === bestChance ? "is-best" : ""}`}><span className="s-cmp-label">{S.cmpChance(fmtInt(budget))}</span>{fmtPct(at(r))}</span>
              </>
            ) : (
              <>
                <span role="cell" className={`s-cmp-num ${res?.status === "error" ? "err-text" : "muted"}`}>{res?.status === "error" ? errorText(T, res) : T.compare.calculating}</span>
                <span role="cell" />
                <span role="cell" />
              </>
            )}
            <span className="s-cmp-actions" role="cell">
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => load(it)}>{S.cmpOpen}</button>
              <button type="button" className="s-remove" onClick={() => remove(it.id)} aria-label={T.compare.remove(it.name)} title={T.compare.remove(it.name)}><TrashIcon /></button>
            </span>
          </div>
        ))}
      </div>
      <div className="s-actions">
        {children}
        <CompareExport rows={rows} ready={ready} budget={budget} chartRef={chartRef}
          showBest={settings?.showBest !== false} showWorst={settings?.showWorst !== false} buttonClass="btn" up />
      </div>
    </div>
  );
}
