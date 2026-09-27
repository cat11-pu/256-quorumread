// app.js：渲染结果
import { quorumOf, readQuorum } from "./quorum.js";
import { step, close } from "./repairrun.js";

export function render(spec) {
  const events = spec.events || [];
  const half = Math.ceil(events.length / 2);
  const first = step(spec);
  const closed = close(Object.assign({}, spec, { state: first.state }));
  const r1 = step(Object.assign({}, spec, { events: events.slice(0, half) }));
  const r2 = step(Object.assign({}, spec, { state: r1.state, events: events.slice(half) }));
  const closedTwo = close(Object.assign({}, spec, { state: r2.state }));
  const replay = step(Object.assign({}, spec, { state: closed.state }));
  const wide = step(Object.assign({}, spec, { budget: spec.budget + 2 }));
  const full = step(Object.assign({}, spec, { budget: events.length + 2 }));
  const fullClosed = close(Object.assign({}, spec, { state: full.state }));
  const repIds = Object.keys(closed.state.reps).sort();
  const allKeys = function (state) {
    const keys = {};
    repIds.forEach(function (rep) {
      Object.keys(state.reps[rep] || {}).forEach(function (key) { keys[key] = true; });
    });
    return Object.keys(keys).sort();
  };
  const fingerprint = function (state) {
    return JSON.stringify({
      reps: repIds.map(function (rep) { return [rep, state.reps[rep]]; }),
      pending: state.pending.map(function (pair) { return pair.join(":"); }).sort(),
      applied: state.applied.length
    });
  };
  const keys = allKeys(closed.state);
  const versions = keys.map(function (key) {
    return [key].concat(repIds.map(function (rep) { return (closed.state.reps[rep] || {})[key] || 0; }));
  });
  return { versions: versions, replicas: repIds.length,
           consistent: versions.every(function (row) {
             return row.slice(1).every(function (value) { return value === row[1]; });
           }),
           reads: first.reads, healed_first: first.healed_count,
           healed_wide: wide.healed_count, pair_differs: first.healed_count !== wide.healed_count,
           pending: first.pending, pending_ids: first.pending_ids,
           catchup: closed.catchup, pending_after: closed.state.pending.length,
           mid_differs: fingerprint(r2.state) !== fingerprint(first.state),
           closed_equal: fingerprint(closedTwo.state) === fingerprint(closed.state),
           replay: replay.healed_count, judged: first.judged, judged_bound: first.judged_bound,
           full_diff: fingerprint(closed.state) === fingerprint(fullClosed.state) ? 0 : 1,
           count: events.length, tail: quorumOf(repIds.length) + readQuorum(closed.state.reps, repIds, keys[0] || "").version };
}
