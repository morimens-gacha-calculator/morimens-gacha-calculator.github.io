// Everyday wording, laid over the normal (technical) texts when Settings › Wording is Simple,
// or set to follow the view and the simple view is on. Only the words that differ are here.
export default {
  stats: {
    average: "On average it takes",
    median: "Half of players are done by",
    medianSub: "pulls",
    p90: "9 in 10 players are done by",
    guaranteedSub: "the banner's guarantees make it certain",
    p99: "99 in 100 players are done by",
    noGuarantee: "nothing makes it certain",
  },
  pct: {
    average: "On average",
    guaranteed: "Guaranteed by",
  },
  chart: {
    average: (n) => `average ${n}`,
    median: (n) => `half by ${n}`,
    pctAt: (p, n) => (p === 90 ? `9 in 10 by ${n}` : `${p}% by ${n}`),
  },
};
