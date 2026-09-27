// repairrun.js：按修复预算处理读写修事件，预算用尽把修复请求压在账上带过下一轮
import { quorumOf, readQuorum } from "./quorum.js";

function error(spec, slot, fallback) {
  const code = (spec && spec[slot]) || fallback;
  const err = new Error(code);
  err.code = code;
  return err;
}

function isKey(value) {
  return typeof value === "string" && value.length > 0;
}

function initState(spec) {
  const incoming = (spec && spec.state) || {};
  const reps = {};
  const source = incoming.reps || {};
  Object.keys(source).forEach(function (rep) {
    reps[rep] = Object.assign({}, source[rep] || {});
  });
  const repTotal = Number(spec && spec.reps);
  if (Number.isFinite(repTotal)) {
    for (let i = 1; i <= repTotal; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(reps, String(i))) reps[String(i)] = {};
    }
  }
  return {
    reps: reps,
    pending: Array.isArray(incoming.pending) ? incoming.pending.map(function (pair) { return [pair[0], pair[1]]; }) : [],
    pending_ids: Array.isArray(incoming.pending_ids) ? incoming.pending_ids.slice() : [],
    healed: Array.isArray(incoming.healed) ? incoming.healed.map(function (entry) { return entry.slice(); }) : [],
    applied: Array.isArray(incoming.applied) ? incoming.applied.slice() : []
  };
}

function repIdSet(state) {
  const ids = {};
  Object.keys(state.reps).forEach(function (rep) { ids[rep] = true; });
  return ids;
}

function isIdList(value, known) {
  if (!Array.isArray(value)) return false;
  for (const rep of value) {
    if (typeof rep !== "string" || !known[rep]) return false;
  }
  return true;
}

function uniqueIds(ids) {
  const seen = {};
  const out = [];
  ids.forEach(function (rep) {
    if (!seen[rep]) { seen[rep] = true; out.push(rep); }
  });
  return out;
}

function validateEvent(event, known) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  if (!(typeof event.id === "number" || isKey(event.id))) return false;
  if (event.kind === "write") {
    return isKey(event.key) && typeof event.value === "number" && isIdList(event.acks, known);
  }
  if (event.kind === "read") {
    return isKey(event.key) && isIdList(event.from, known);
  }
  if (event.kind === "repair") {
    return typeof event.rep === "string" && isKey(event.key);
  }
  return false;
}

function findPending(state, rep, key) {
  for (let i = 0; i < state.pending.length; i += 1) {
    if (state.pending[i][0] === rep && state.pending[i][1] === key) return i;
  }
  return -1;
}

function latestVersion(state, key) {
  let version = null;
  Object.keys(state.reps).forEach(function (rep) {
    const entries = state.reps[rep];
    if (entries && Object.prototype.hasOwnProperty.call(entries, key)) {
      if (version === null || entries[key] > version) version = entries[key];
    }
  });
  return version;
}

export function step(spec) {
  const state = initState(spec || {});
  const known = repIdSet(state);
  const repCount = Object.keys(state.reps).length;
  const q = quorumOf(repCount);
  let budget = Number(spec && spec.budget);
  if (!Number.isFinite(budget) || budget < 0) budget = 0;
  budget = Math.floor(budget);
  const events = Array.isArray(spec && spec.events) ? spec.events : [];
  const reads = [];
  const healedNow = [];
  let judged = 0;

  for (const event of events) {
    if (!validateEvent(event, known)) throw error(spec, "event_error_code", "E_BAD_EVENT");
    if (state.applied.indexOf(event.id) !== -1) continue;
    state.applied.push(event.id);
    judged += 1;

    if (event.kind === "write") {
      const acks = uniqueIds(event.acks);
      if (acks.length < q) throw error(spec, "quorum_error_code", "E_NO_QUORUM");
      acks.forEach(function (rep) { state.reps[rep][event.key] = event.value; });
    } else if (event.kind === "read") {
      const from = uniqueIds(event.from);
      if (from.length < q) throw error(spec, "quorum_error_code", "E_NO_QUORUM");
      let exists = false;
      from.forEach(function (rep) {
        const entries = state.reps[rep];
        if (entries && Object.prototype.hasOwnProperty.call(entries, event.key)) exists = true;
      });
      if (!exists) throw error(spec, "unknown_error_code", "E_UNKNOWN_KEY");
      const result = readQuorum(state.reps, from, event.key);
      reads.push(result.version);
      result.lagging.forEach(function (rep) {
        if (findPending(state, rep, event.key) === -1) state.pending.push([rep, event.key]);
      });
    } else {
      const index = findPending(state, event.rep, event.key);
      if (index === -1) throw error(spec, "pending_error_code", "E_NOT_PENDING");
      if (budget >= 1) {
        const version = latestVersion(state, event.key);
        state.reps[event.rep][event.key] = version;
        state.pending.splice(index, 1);
        state.healed.push([event.id, event.rep, event.key]);
        healedNow.push([event.id, event.rep, event.key]);
        budget -= 1;
      } else if (state.pending_ids.indexOf(event.id) === -1) {
        state.pending_ids.push(event.id);
      }
    }
  }

  return {
    state: state,
    reads: reads,
    healed: healedNow,
    healed_count: healedNow.length,
    pending: state.pending.length,
    pending_ids: state.pending_ids,
    judged: judged,
    judged_bound: events.length
  };
}

export function close(spec) {
  const state = initState(spec || {});
  let catchup = 0;
  while (state.pending.length > 0) {
    const pair = state.pending.shift();
    const rep = pair[0];
    const key = pair[1];
    const version = latestVersion(state, key);
    if (version !== null) {
      if (!state.reps[rep]) state.reps[rep] = {};
      state.reps[rep][key] = version;
    }
    catchup += 1;
  }
  state.pending_ids = [];
  return { state: state, catchup: catchup };
}
