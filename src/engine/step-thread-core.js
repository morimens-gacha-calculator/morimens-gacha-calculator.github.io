// Helper thread for stepping one big chain on several cores (see chain-step.js).
//
// Set up once (while the calculating thread is still free to send messages): every helper gets
// the same growable shared WebAssembly memory and a control block. After that, jobs are announced
// only through shared memory — a busy (blocked) calculating thread can't send messages, as
// browsers deliver them to a nested worker only when its parent yields.
//
// Control block (Int32): JOB counter, GEN step counter, DONE count, READY count, STOP flag, then
// the job: offsets of the chain arrays, N, number of weight vectors and their offsets, and the
// range [j0, j1) of each helper. Each helper computes its states in "pull" form, so threads
// never write the same place; partial sums go to a shared Float64 area.

export const PULL_B64 = "AGFzbQEAAAABDAFgB39/f39/f38BfAIPAQNlbnYDbWVtAgMBgIAEAwIBAAcIAQRwdWxsAAAKpAEBoQECA38CfCAFIQcgACAFQQJ0aigCACEIAkADQCAHIAZPDQEgACAHQQFqQQJ0aigCACEJRAAAAAAAAAAAIQoCQANAIAggCU8NASAKIAMgASAIQQJ0aigCAEEDdGorAwAgAiAIQQN0aisDAKKgIQogCEEBaiEIDAALCyAEIAdBA3RqIAo5AwAgB0EARwRAIAsgCqAhCwsgB0EBaiEHDAALCyALCw==";
export const CTRL = { JOB: 0, GEN: 1, DONE: 2, READY: 3, STOP: 4, RS: 5, SRC: 6, PROB: 7, A: 8, B: 9, N: 10, NW: 11, SUMS: 12, W0: 16, RANGE0: 32 };
export const MAX_WEIGHTS = 16;
export const CTRL_WORDS = 32 + 2 * 64;

let pullModule = null;
export function pullKernel() {
  if (!pullModule) {
    const bin = typeof atob === "function"
      ? Uint8Array.from(atob(PULL_B64), (ch) => ch.charCodeAt(0))
      : Uint8Array.from(Buffer.from(PULL_B64, "base64"));
    pullModule = new WebAssembly.Module(bin);
  }
  return pullModule;
}

// send(msg) posts to the parent; call the returned handler with each message received
export function threadMain(send) {
  send({ type: "ready" });
  return (msg) => {
    if (!msg || msg.type !== "init") return;
    send({ type: "initialised" });
    // give the reply a moment to leave, then live in the shared-memory loop for good
    setTimeout(() => serve(msg), 0);
  };
}

function serve({ mem, ctrl, slot }) {
  const { pull } = new WebAssembly.Instance(pullKernel(), { env: { mem } }).exports;
  const ctl = new Int32Array(ctrl);
  let job = Atomics.load(ctl, CTRL.JOB);
  for (;;) {
    Atomics.wait(ctl, CTRL.JOB, job); // idle until the next job
    job = Atomics.load(ctl, CTRL.JOB);
    const N = ctl[CTRL.N], nW = ctl[CTRL.NW];
    const j0 = ctl[CTRL.RANGE0 + 2 * slot], j1 = ctl[CTRL.RANGE0 + 2 * slot + 1];
    const rs = ctl[CTRL.RS], src = ctl[CTRL.SRC], prob = ctl[CTRL.PROB], A = ctl[CTRL.A], B = ctl[CTRL.B], sumsAt = ctl[CTRL.SUMS];
    const stride = 1 + nW;
    let gen = Atomics.load(ctl, CTRL.GEN);
    Atomics.add(ctl, CTRL.READY, 1);
    Atomics.notify(ctl, CTRL.READY);
    for (;;) {
      Atomics.wait(ctl, CTRL.GEN, gen, 1000);
      if (Atomics.load(ctl, CTRL.JOB) !== job || Atomics.load(ctl, CTRL.STOP)) break; // job over
      const g = Atomics.load(ctl, CTRL.GEN);
      if (g === gen) continue;
      gen = g;
      const curAt = g & 1 ? A : B, nextAt = g & 1 ? B : A;
      const total = pull(rs, src, prob, curAt, nextAt, j0, j1);
      const buf = mem.buffer; // views made after any growth
      const sums = new Float64Array(buf, sumsAt, stride * 64);
      sums[slot * stride] = total;
      if (nW) {
        const next = new Float64Array(buf, nextAt, N);
        for (let w = 0; w < nW; w++) {
          const wv = new Float64Array(buf, ctl[CTRL.W0 + w], N);
          let s = 0;
          for (let j = Math.max(1, j0); j < j1; j++) s += next[j] * wv[j];
          sums[slot * stride + 1 + w] = s;
        }
      }
      Atomics.add(ctl, CTRL.DONE, 1);
      Atomics.notify(ctl, CTRL.DONE);
    }
  }
}
