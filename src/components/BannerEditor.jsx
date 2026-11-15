import { useState } from "react";
import { useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import { chanceSum, fromEngineTree, leaf, node, num, pathOf, keyOf, remapKeys, toEngineTree, allAlts } from "../model.js";

// Edit the outcome tree. All edits go through `edit`, which clones the tree first.
export default function BannerEditor({ state, update }) {
  const T = useT();
  const B = T.banner;
  const [json, setJson] = useState(null);
  const [jsonMsg, setJsonMsg] = useState("");

  const edit = (fn) => update((s) => {
    const banner = structuredClone(s.banner);
    const res = fn(banner, s) ?? {};
    return { ...(res.state ?? s), banner };
  }, { custom: true });

  const nodeIn = (tree, key) => { let n = tree; for (const i of pathOf(key)) n = n.alts[i].children; return n; };
  const altIn = (tree, key) => { const p = pathOf(key); return nodeIn(tree, keyOf(p.slice(0, -1))).alts[p[p.length - 1]]; };

  const setField = (key, f, v) => edit((t) => { altIn(t, key)[f] = v; });
  const setStreak = (key, v) => edit((t) => { nodeIn(t, key).streak = Math.max(0, Math.floor(num(v))); });
  const addAlt = (key) => edit((t) => { nodeIn(t, key).alts.push(leaf(B.newOutcome, "0")); });
  const split = (key) => edit((t) => {
    const a = altIn(t, key);
    a.children = node([leaf("A", "1/2", { count: a.count, items: a.items }), leaf("B", "1/2")]);
    a.count = 1; a.items = "";
  });
  const unsplit = (key) => edit((t, s) => {
    altIn(t, key).children = null;
    return { state: remapKeys(s, (k) => (k.startsWith(key + ",") ? null : k)) };
  });
  // Move an outcome up or down among its siblings. The order is the priority: when two hard
  // pities are due on the same pull, the higher one wins. Pity, memory and plan rows follow it.
  const move = (key, dir) => edit((t, s) => {
    const p = pathOf(key), parent = keyOf(p.slice(0, -1)), i = p[p.length - 1], j = i + dir, depth = p.length - 1;
    const n = nodeIn(t, parent);
    if (j < 0 || j >= n.alts.length) return undefined;
    [n.alts[i], n.alts[j]] = [n.alts[j], n.alts[i]];
    const next = remapKeys(s, (k) => {
      const q = pathOf(k);
      if (q.length <= depth || keyOf(q.slice(0, depth)) !== parent) return k;
      if (q[depth] === i) q[depth] = j; else if (q[depth] === j) q[depth] = i;
      return keyOf(q);
    });
    // memory remembers this group's last outcome by its position
    const mem = next.start.streak?.[parent];
    if (mem) next.start = { ...next.start, streak: { ...next.start.streak, [parent]: [mem[0] === i ? j : mem[0] === j ? i : mem[0], mem[1]] } };
    return { state: next };
  });
  const remove = (key) => edit((t, s) => {
    const p = pathOf(key), parent = keyOf(p.slice(0, -1)), idx = p[p.length - 1], depth = p.length - 1;
    const n = nodeIn(t, parent);
    if (n.alts.length <= 1) return;
    n.alts.splice(idx, 1);
    return {
      state: remapKeys(s, (k) => {
        const q = pathOf(k);
        if (q.length <= depth || keyOf(q.slice(0, depth)) !== parent) return k;
        if (q[depth] === idx) return null;
        if (q[depth] > idx) q[depth]--;
        return keyOf(q);
      }),
    };
  });

  const applyJson = () => {
    try {
      const banner = fromEngineTree(JSON.parse(json));
      update((s) => {
        const keys = new Set(allAlts(banner).map((a) => a.key));
        const next = remapKeys({ ...s, banner }, (k) => (keys.has(k) ? k : null));
        if (!next.goal.length) next.goal = [{ id: "r0", path: "0", type: "total", item: 0, k: 1, copies: 1, from: "" }];
        return next;
      }, { custom: true });
      setJsonMsg(B.jsonApplied);
    } catch (e) { setJsonMsg(B.jsonFailed(e.message)); }
  };

  const renderNode = (n, key, title) => {
    const sum = chanceSum(n);
    return (
      <div className={`tree-node ${key === "" ? "is-root" : ""}`}>
        {title && <div className="tree-node-title">{title}</div>}
        {key === "" && <p className="muted small order-hint">{B.orderHint}</p>}
        {n.alts.map((a, i) => {
          const k = key === "" ? `${i}` : `${key},${i}`;
          return <AltRow key={k} a={a} k={k} canRemove={n.alts.length > 1} canUp={i > 0} canDown={i < n.alts.length - 1} move={move}
            setField={setField} split={split} unsplit={unsplit} remove={remove} renderNode={renderNode} />;
        })}
        <div className="tree-foot">
          <span className={`chip ${sum.ok ? "chip--ok" : "chip--err"}`}>{sum.text}</span>
          <button type="button" className="btn btn--small" onClick={() => addAlt(key)}>{B.addOutcome}</button>
          <label className="inline-field">
            {B.memoryMax}
            <input type="number" className="custom-input w-xs" min="0" value={n.streak || ""} placeholder={B.memoryOff} onChange={(e) => setStreak(key, e.target.value)} aria-label={B.memoryLabel} />
            {B.memoryInARow}
          </label>
        </div>
      </div>
    );
  };

  return (
    <div className="banner-editor">
      {renderNode(state.banner, "", B.eachPull)}
      <details className="json-box" onToggle={(e) => e.currentTarget.open && setJson(JSON.stringify(toEngineTreeSafe(state.banner), null, 1))}>
        <summary>{B.editJson}</summary>
        <textarea className="json-area" spellCheck="false" value={json ?? ""} onChange={(e) => setJson(e.target.value)} aria-label={B.jsonLabel} />
        <div className="row">
          <button type="button" className="btn btn--small" onClick={applyJson}>{B.applyJson}</button>
          <span className="muted small">{jsonMsg || B.jsonHint}</span>
        </div>
      </details>
    </div>
  );
}

function toEngineTreeSafe(t) { try { return toEngineTree(t); } catch { return null; } }

function AltRow({ a, k, canRemove, canUp, canDown, move, setField, split, unsplit, remove, renderNode }) {
  const B = useT().banner;
  const isLeaf = !a.children;
  const pool = isLeaf && num(a.count, 1) > 1;
  const id = (f) => `alt-${k.replace(/,/g, "-")}-${f}`;
  return (
    <div className="tree-alt">
      <div className="alt-order" role="group" aria-label={B.orderOf(a.name)}>
        <button type="button" className="order-btn" disabled={!canUp} onClick={() => move(k, -1)} aria-label={B.moveUp(a.name)} title={B.moveUpTitle}>↑</button>
        <button type="button" className="order-btn" disabled={!canDown} onClick={() => move(k, 1)} aria-label={B.moveDown(a.name)} title={B.moveDownTitle}>↓</button>
      </div>
      <div className="alt-grid">
        <label className="field"><span className="field-label">{B.name}</span>
          <input id={id("name")} type="text" className="custom-input" value={a.name} onChange={(e) => setField(k, "name", e.target.value)} />
        </label>
        <label className="field"><span className="field-label">{B.chance}</span>
          <input id={id("p")} type="text" className="custom-input w-s" value={a.p} onChange={(e) => setField(k, "p", e.target.value)} />
        </label>
        {isLeaf && (
          <label className="field"><span className="field-label">{B.itemsInPool}</span>
            <NumberInput id={id("count")} min={1} className="custom-input w-xs" value={num(a.count, 1)} onChange={(v) => setField(k, "count", v)} />
          </label>
        )}
        <label className="field"><span className="field-label">{B.hardPity}</span>
          <input id={id("pity")} type="number" min="0" className="custom-input w-xs" value={a.pity} placeholder="–" onChange={(e) => setField(k, "pity", e.target.value)} />
        </label>
        <label className="field"><span className="field-label">{B.softFrom}</span>
          <input id={id("softStart")} type="number" min="0" className="custom-input w-xs" value={a.softStart} placeholder="–" onChange={(e) => setField(k, "softStart", e.target.value)} />
        </label>
        <label className="field"><span className="field-label">{B.softStep}</span>
          <input id={id("softStep")} type="text" className="custom-input w-xs" value={a.softStep} placeholder="6%" onChange={(e) => setField(k, "softStep", e.target.value)} />
        </label>
      </div>
      {pool && (
        <label className="field">
          <span className="field-label">{B.itemNames}</span>
          <input id={id("items")} type="text" className="custom-input" value={a.items ?? ""} placeholder={Array.from({ length: Math.min(num(a.count), 6) }, (_, i) => B.itemN(i + 1)).join(", ")} onChange={(e) => setField(k, "items", e.target.value)} />
        </label>
      )}
      <div className="alt-actions">
        <label className="check">
          <input type="checkbox" checked={!!a.pityYields} onChange={(e) => setField(k, "pityYields", e.target.checked)} />
          {B.pityYields}
        </label>
        {num(a.pity) > 0 && (
          <div className="pity-rules">
            <label className="field"><span className="field-label">{B.resetBy}</span>
              <select id={id("resetBy")} className="select" value={a.pityResetBy ?? "self"} onChange={(e) => setField(k, "pityResetBy", e.target.value)}>
                <option value="self">{B.resetBySelf}</option>
                <option value="above">{B.resetByAbove}</option>
              </select>
            </label>
            <label className="field"><span className="field-label">{B.preempt}</span>
              <select id={id("preempt")} className="select" value={a.onPreempt ?? "carry"} onChange={(e) => setField(k, "onPreempt", e.target.value)}>
                <option value="carry">{B.preemptCarry}</option>
                <option value="lose">{B.preemptLose}</option>
              </select>
            </label>
          </div>
        )}
        {isLeaf
          ? <button type="button" className="btn btn--small" onClick={() => split(k)}>{B.split}</button>
          : <button type="button" className="btn btn--small" onClick={() => unsplit(k)}>{B.unsplit}</button>}
        {canRemove && <button type="button" className="btn btn--small btn--danger" onClick={() => remove(k)} aria-label={B.removeNamed(a.name)}>{B.remove}</button>}
      </div>
      {a.children && renderNode(a.children, k, B.splitsInto(a.name))}
    </div>
  );
}
