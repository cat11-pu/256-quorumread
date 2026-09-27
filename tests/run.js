import assert from "node:assert";
import { quorumOf, readQuorum } from "../quorum.js";
import { step, close } from "../repairrun.js";
import { render } from "../app.js";

const base = {
  reps: 3, budget: 1,
  state: { reps: { "1": {}, "2": {}, "3": {} }, pending: [], healed: [], applied: [] },
  events: [],
  quorum_error_code: "E_NO_QUORUM", pending_error_code: "E_NOT_PENDING",
  unknown_error_code: "E_UNKNOWN_KEY", event_error_code: "E_BAD_EVENT"
};

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("ok " + name); } catch (e) { failed += 1; console.log("FAIL " + name + " :: " + e.message); }
}

check("quorumOf returns a number", () => {
  assert.strictEqual(typeof quorumOf(3), "number");
});

check("readQuorum returns a version", () => {
  assert.strictEqual(typeof readQuorum(base.state.reps, ["1"], "k1").version, "number");
});

check("step returns a state", () => {
  assert.strictEqual(typeof step(base).state, "object");
});

check("close returns a state", () => {
  assert.strictEqual(typeof close(base).state, "object");
});

check("render counts events", () => {
  assert.strictEqual(typeof render(base).count, "number");
});

console.log("5 cases, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
