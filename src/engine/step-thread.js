// Web Worker entry for a chain-stepping helper thread (logic in step-thread-core.js).
import { threadMain } from "./step-thread-core.js";

const onJob = threadMain((msg) => self.postMessage(msg));
self.onmessage = ({ data }) => onJob(data);
