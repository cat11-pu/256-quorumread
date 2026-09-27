// repairrun.js：按修复预算处理事件（写法定数落值、读取最高版本、修复只动账内条目）
import { quorumOf, readQuorum } from "./quorum.js";

function code(spec, key, fallback) {
  return (spec && spec[key]) || fallback;
}

function fail(spec, key, fallback, message) {
  const error = new Error(message);
  error.code = code(spec, key, fallback);
  throw error;
}

// 深克隆跨轮状态，保证同一份 spec 在不同预算档重放时互不污染。
function cloneState(state) {
  const source = state || {};
  const reps = {};
  const sourceReps = source.reps || {};
  for (const rep of Object.keys(sourceReps)) {
    reps[rep] = Object.assign({}, sourceReps[rep]);
  }
  const values = {};
  const sourceValues = source.values || {};
  for (const k of Object.keys(sourceValues)) {
    values[k] = Object.assign({}, sourceValues[k]);
  }
  return {
    reps,
    values,
    pending: (source.pending || []).map((entry) => [entry[0], entry[1], entry[2] === undefined ? null : entry[2]]),
    healed: (source.healed || []).slice(),
    applied: (source.applied || []).slice()
  };
}

function repIdList(spec, state) {
  const ids = {};
  Object.keys(state.reps).forEach((rep) => { ids[rep] = true; });
  if (Number.isInteger(spec.reps) && spec.reps > 0) {
    for (let i = 1; i <= spec.reps; i++) ids[String(i)] = true;
  }
  return Object.keys(ids).sort();
}

function pendingIndex(state) {
  const map = new Map();
  state.pending.forEach((entry, index) => map.set(entry[0] + "\u0000" + entry[1], index));
  return map;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validate(event) {
  if (!isObject(event) || typeof event.id === "undefined" || typeof event.kind !== "string") return false;
  if (event.kind === "write") {
    return typeof event.key === "string" && Array.isArray(event.acks);
  }
  if (event.kind === "read") {
    return typeof event.key === "string" && Array.isArray(event.from);
  }
  if (event.kind === "repair") {
    return typeof event.rep === "string" && typeof event.key === "string";
  }
  return false;
}

// 从全部副本找某键最新版本；返回 0 表示集群里没有这个键。
function latestVersion(state, key) {
  let version = 0;
  for (const rep of Object.keys(state.reps)) {
    const seen = Number(state.reps[rep][key]) || 0;
    if (seen > version) version = seen;
  }
  return version;
}

export function step(spec) {
  const source = spec || {};
  const state = cloneState(source.state);
  const events = Array.isArray(source.events) ? source.events : [];
  const budget = Number.isFinite(Number(source.budget)) ? Number(source.budget) : 0;
  const allReps = repIdList(source, state);
  const q = quorumOf(allReps.length);
  const applied = new Set(state.applied);
  const reads = [];
  const healed = [];
  let remaining = budget;
  let judged = 0;

  for (const event of events) {
    if (!validate(event)) {
      fail(source, "event_error_code", "E_BAD_EVENT", "bad event: " + JSON.stringify(event));
    }
    if (applied.has(event.id)) continue;
    judged += 1;

    if (event.kind === "write") {
      const acks = new Set(event.acks);
      if (acks.size < q) {
        fail(source, "quorum_error_code", "E_NO_QUORUM",
          "write ack count " + acks.size + " < quorum " + q);
      }
      const nextVersion = latestVersion(state, event.key) + 1;
      for (const rep of acks) {
        if (!state.reps[rep]) state.reps[rep] = {};
        state.reps[rep][event.key] = nextVersion;
      }
      if (!state.values[event.key]) state.values[event.key] = {};
      state.values[event.key][String(nextVersion)] = event.value;
    } else if (event.kind === "read") {
      const from = Array.isArray(event.from) ? event.from : [];
      if (from.length < q) {
        fail(source, "quorum_error_code", "E_NO_QUORUM",
          "read response count " + from.length + " < quorum " + q);
      }
      const result = readQuorum(state.reps, from, event.key);
      if (result.version === 0) {
        fail(source, "unknown_error_code", "E_UNKNOWN_KEY", "no value for key " + event.key);
      }
      const values = state.values[event.key] || {};
      reads.push(values[String(result.version)]);
      const index = pendingIndex(state);
      for (const rep of result.lagging) {
        if (!index.has(rep + "\u0000" + event.key)) {
          state.pending.push([rep, event.key, null]);
          index.set(rep + "\u0000" + event.key, state.pending.length - 1);
        }
      }
    } else {
      const index = pendingIndex(state);
      const at = index.get(event.rep + "\u0000" + event.key);
      if (at === undefined) {
        fail(source, "pending_error_code", "E_NOT_PENDING",
          "repair for rep " + event.rep + " key " + event.key + " is not on the ledger");
      }
      if (remaining <= 0) {
        // 预算整批用尽：修复请求压在账上，带出下一轮/收尾。
        state.pending[at][2] = event.id;
      } else {
        const version = latestVersion(state, event.key);
        if (version > 0) {
          if (!state.reps[event.rep]) state.reps[event.rep] = {};
          state.reps[event.rep][event.key] = version;
        }
        state.pending.splice(at, 1);
        healed.push([event.rep, event.key, event.id]);
        remaining -= 1;
      }
    }

    applied.add(event.id);
  }

  state.applied = Array.from(applied);
  state.healed = (state.healed || []).concat(healed);
  return {
    state,
    reads,
    healed,
    healed_count: healed.length,
    pending: state.pending.length,
    pending_ids: state.pending.map((entry) => entry[2]).filter((id) => id !== null),
    judged,
    judged_bound: events.length
  };
}

// 收尾：不限预算，把账上条目全部修完。
export function close(spec) {
  const source = spec || {};
  const state = cloneState(source.state);
  let catchup = 0;

  for (const entry of state.pending) {
    const rep = entry[0];
    const key = entry[1];
    const version = latestVersion(state, key);
    if (!state.reps[rep]) state.reps[rep] = {};
    if ((Number(state.reps[rep][key]) || 0) < version) {
      if (version > 0) state.reps[rep][key] = version;
      catchup += 1;
    }
  }
  state.pending = [];
  return { state, catchup };
}
