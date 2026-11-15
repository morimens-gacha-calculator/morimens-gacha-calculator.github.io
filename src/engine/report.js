// The budget report ("I have B pulls, what will I get?"), built the same way for every method.
// A method supplies only what is its own:
//   goalByPull[t]          P(goal met after t pulls), t = 0…B
//   expectedByPull[i][t]   row i's expected progress after t pulls
//   distAtB[i][v]          P(row i's progress = v after B pulls), v = 0…rows[i].max
// rows: from rowShape (goal.js). Rounding is cleaned up here: chances are kept within 0…1.

export function makeReport(B, rows, goalByPull, expectedByPull, distAtB) {
  const goal = Float64Array.from(goalByPull, (v) => Math.min(1, Math.max(0, v)));
  return {
    pulls: B,
    chanceGoal: goal[B],      // P(goal met after B pulls)
    goalByPull: goal,         // chart: same, for every pull 0…B
    requirements: rows.map((r, i) => {
      const dist = Float64Array.from(distAtB[i], (v) => (v > 0 ? v : 0)); // top value = "that many or more"
      const target = r.type === "distinct" ? r.k : r.copies;
      let chanceMet = 0;
      for (let v = target; v <= r.max; v++) chanceMet += dist[v];
      return {
        label: r.label,
        type: r.type, copies: r.copies,
        target,
        dist,
        mean: expectedByPull[i][B],
        chanceMet,
        expectedByPull: expectedByPull[i], // chart: expected progress after t pulls
      };
    }),
  };
}

// out[v] += q · d[v] for v ≤ max: mixing a pool row's progress distribution after n hits into a
// report (split and layered methods)
export function addScaled(out, d, q, max = out.length - 1) {
  for (let v = 0; v < d.length && v <= max; v++) out[v] += q * d[v];
}
