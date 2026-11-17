import { useEffect, useState } from "react";
import { allAlts, allNodes, fmtInt, fmtPct, itemNames, newId, num, reqLabel } from "../model.js";
import { errorText, useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import Progress from "./Progress.jsx";
import ResultChart from "./ResultChart.jsx";

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

export function rowChoice(banner, row) {
  const a = allAlts(banner).find((x) => x.key === row.path);
  if (!a) return "custom";
  const subset = Array.isArray(row.items) && row.items.length && row.type !== "specific";
  if (a.isPool) {
    if (subset) return "custom";
    if (row.type === "total") return `${a.key}|any`;
    if (row.type === "specific") return `${a.key}|item|${row.item ?? 0}`;
    if (row.type === "distinct") return row.k >= itemNames(a.alt).length ? `${a.key}|every` : `${a.key}|distinct`;
  }
  if (row.type === "total" && !subset && !(a.isLeaf && a.depth === 0)) return `${a.key}|any`;
  return "custom";
}

function applyChoice(banner, row, value) {
  const [path, kind, item] = value.split("|");
  const n = poolSize(banner, path);
  const base = { ...row, path, items: null, from: path === row.path ? row.from : "" };
  if (kind === "item") return { ...base, type: "specific", item: Number(item), from: path === row.path && row.type === "specific" && row.item === Number(item) ? row.from : "" };
  if (kind === "every") return { ...base, type: "distinct", k: n, from: "" };
  if (kind === "distinct") {
    const k = row.type === "distinct" && row.k < n ? row.k : Math.max(2, Math.min(3, n - 1));
    return { ...base, type: "distinct", k, from: "" };
  }
  return { ...base, type: "total" };
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
function GoalLine({ state, update, row, index, choices, showHave }) {
  const T = useT();
  const S = T.simple;
  const value = rowChoice(state.banner, row);
  const kind = value.split("|")[1];
  const n = poolSize(state.banner, row.path);
  const set = (fn) => update((s) => ({ ...s, goal: s.goal.map((r) => (r.id === row.id ? fn(r) : r)) }));
  const remove = () => update((s) => ({ ...s, goal: s.goal.filter((r) => r.id !== row.id) }));
  const canHave = kind === "any" || kind === "item";
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
        <select className="select s-field s-what" value={value} aria-label={S.whatLabel(index + 1)}
          onChange={(e) => set((r) => applyChoice(state.banner, r, e.target.value))}>
          {value === "custom" && <option value="custom" disabled>{reqLabel(state.banner, row)} ({S.customGoal})</option>}
          {choices.groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))}
          {choices.other.length > 0 && (
            <optgroup label={S.otherGroup}>
              {choices.other.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          )}
        </select>
        {kind === "distinct" && (
          <label className="s-inline">
            <NumberInput className="custom-input s-field s-num" min={1} max={n} value={row.k}
              onChange={(v) => set((r) => ({ ...r, k: v }))} aria-label={S.howManyDifferent} />
            <span>{S.different}</span>
          </label>
        )}
        <label className="s-inline">
          <span aria-hidden="true">×</span>
          <NumberInput className="custom-input s-field s-num" min={1} max={999} value={row.copies}
            onChange={(v) => set((r) => ({ ...r, copies: v }))} aria-label={S.copiesLabel} />
          {(kind === "distinct" || kind === "every") && <span>{S.each}</span>}
        </label>
        {state.goal.length > 1 && (
          <button type="button" className="s-remove" onClick={remove} aria-label={S.removeGoal}>×</button>
        )}
      </div>
      {showHave && canHave && (
        <label className="s-inline s-have">
          <span>{S.alreadyHave}</span>
          <NumberInput className="custom-input s-field s-num" min={0} max={998} value={Math.floor(num(row.from, 0))}
            onChange={(v) => set((r) => ({ ...r, from: v ? String(v) : "" }))} aria-label={S.alreadyHave} />
        </label>
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
      {pityAlts.map((a) => (
        <label key={a.key} className="s-row">
          <span>{S.sinceLast(a.name)}</span>
          <NumberInput className="custom-input s-field s-num" min={0} max={Math.max(0, num(a.alt.pity) - 1)}
            value={state.start.pity[a.key] ?? 0} onChange={(v) => setPity(a.key, v)} />
        </label>
      ))}
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
      {pityAlts.length > 0 && <p className="s-hint">{S.pityHint}</p>}
    </>
  );
}

// The first pull with at least chance p, from the distribution
function quantile(r, p) {
  for (let i = 0; i < r.cdf.length; i++) if (r.cdf[i] >= p - 1e-12) return i;
  return null;
}

function Answer({ state, update, engine, theme, onCompare, onDetails }) {
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
  return (
    <section className={`s-card s-answer ${engine.status === "busy" ? "is-updating" : ""}`} aria-label={S.answerLabel} aria-busy={engine.status === "busy"}>
      {engine.status === "busy" && <Progress engine={engine} compact />}
      <p className="s-context">{budgetMode ? S.contextBudget(goals, fmtInt(state.budget)) : S.contextPulls(goals)}</p>
      {budgetMode && chance != null ? (
        <p className="s-big">{S.youHave(fmtPct(chance))}</p>
      ) : (
        <p className="s-big">{S.averageBig(fmtInt(r.mean))}</p>
      )}
      <ul className="s-facts">
        {budgetMode && <li>{S.average(fmtInt(r.mean))}</li>}
        {half != null && nine != null && <li>{S.halfAndNine(fmtInt(half), fmtInt(nine))}</li>}
        {!budgetMode && (
          <li className="s-sure">
            <span>{S.toBeSure}</span>
            <NumberInput className="custom-input s-field s-num" integer={false} min={1} max={99.99} value={state.desired}
              onChange={(v) => update((s) => ({ ...s, desired: v }))} aria-label={S.sureLabel} />
            <span>{S.sureResult(r.requiredPulls != null ? fmtInt(r.requiredPulls) : "-")}</span>
          </li>
        )}
        {(settings.showBest !== false && r.min != null && r.min > 0) || (settings.showWorst !== false && r.maxKnown !== false) ? (
          <li className="s-muted">
            {settings.showBest !== false && r.min != null && r.min > 0 && S.earliest(fmtInt(r.min))}
            {settings.showBest !== false && r.min != null && r.min > 0 && settings.showWorst !== false && r.maxKnown !== false && " "}
            {settings.showWorst !== false && r.maxKnown !== false && (r.max != null ? S.guaranteedBy(fmtInt(r.max)) : S.noGuarantee)}
          </li>
        ) : null}
      </ul>
      {budgetMode && r.min != null && state.budget < r.min && <p className="note-box" role="status">{T.target.notPossible(fmtInt(r.min))}</p>}
      <ResultChart state={state} update={update} engine={engine} theme={theme} simple />
      <div className="s-actions">
        <button type="button" className="btn" onClick={onCompare}>{S.compare}</button>
        <button type="button" className="btn" onClick={onDetails}>{S.details}</button>
      </div>
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

export default function SimpleView({ state, update, engine, theme, firstVisit, onExampleDone, onCompare, onDetails }) {
  const T = useT();
  const S = T.simple;
  const [more, setMore] = useState(() => state.goal.some((r) => num(r.from, 0) > 0));
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
        <p className="s-lead">{S.iWant}</p>
        <div className="s-goals">
          {state.goal.map((row, i) => (
            <GoalLine key={row.id} state={state} update={update} row={row} index={i} choices={choices} showHave={more} />
          ))}
        </div>
        <button type="button" className="btn btn--link s-add" onClick={addGoal}>+ {S.addGoal}</button>
        <div className="s-divider" />
        <label className="s-row">
          <span>{S.iHave}</span>
          <input type="number" inputMode="numeric" min={0} className="custom-input s-field s-num s-pulls" value={pullsText}
            placeholder="-" onChange={(e) => onPulls(e.target.value)} aria-describedby="s-pulls-note" />
          <span>{S.pulls}</span>
          <span id="s-pulls-note" className="s-hint">{S.optional}</span>
        </label>
        <StartQuestions state={state} update={update} />
        <button type="button" className="btn s-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? S.lessOptions : S.moreOptions}
        </button>
        {more && <p className="s-hint">{S.moreHint}</p>}
      </section>
      <Answer state={state} update={update} engine={engine} theme={theme} onCompare={onCompare} onDetails={onDetails} />
    </div>
  );
}
