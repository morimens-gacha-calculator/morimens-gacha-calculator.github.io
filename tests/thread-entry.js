// node:worker_threads entry for a helper thread (the browser uses src/engine/step-thread.js)
import { parentPort } from "node:worker_threads";
import { threadMain } from "../src/engine/step-thread-core.js";

const onMessage = threadMain((msg) => parentPort.postMessage(msg));
parentPort.on("message", onMessage);
