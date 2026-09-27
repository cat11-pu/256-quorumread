import fs from "node:fs";
import { quorumOf, readQuorum } from "./quorum.js";
import { step, close } from "./repairrun.js";

// 验收断言：上面每条值收进 emit，最后与期望值逐项比对，不符就非零退出。
const __lines = [];
function emit(label, value) { __lines.push([String(label).replace(/ =$/, ""), value]); }


const spec = JSON.parse(fs.readFileSync(process.argv[2] || "sample/quorum.json", "utf8"));
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

emit("读结果序列 =", JSON.stringify(first.reads));
emit("收尾后每键各副本版本 =", JSON.stringify(keys.map(function (key) {
  return [key].concat(repIds.map(function (rep) { return (closed.state.reps[rep] || {})[key] || 0; }));
})));
emit("收尾后副本一致 =", keys.every(function (key) {
  return repIds.every(function (rep) {
    return ((closed.state.reps[rep] || {})[key] || 0) === ((closed.state.reps[repIds[0]] || {})[key] || 0);
  });
}));
emit("首轮修复条数 =", first.healed_count);
emit("二档修复条数 =", wide.healed_count);
emit("两个预算档修复不同 =", first.healed_count !== wide.healed_count);
emit("收尾前待修复账 =", first.pending);
emit("压在账上的请求 =", JSON.stringify(first.pending_ids));
emit("收尾补齐条数 =", closed.catchup);
emit("收尾后待修复账 =", closed.state.pending.length);
emit("拆两轮中间态不同 =", fingerprint(r2.state) !== fingerprint(first.state));
emit("拆两轮收尾态一致 =", fingerprint(closedTwo.state) === fingerprint(closed.state));
emit("重放新增修复 =", replay.healed_count);
emit("工作计数未超上界 =", first.judged <= first.judged_bound);
emit("与全量对照差异 =", fingerprint(closed.state) === fingerprint(fullClosed.state) ? 0 : 1);


// ---- 异常路径探针：真调用实现，看它报出什么码（不是从样例里抄）----
try {
  step(Object.assign({}, { reps: 3, state: { reps: { "1": {}, "2": {}, "3": {} }, pending: [], healed: [], applied: [] },
    events: [{ id: 1, kind: "write", key: "k1", value: 1, acks: ["1"] }], budget: 1 }));
  emit("确认不足报码", "没有报错");
} catch (error) {
  emit("确认不足报码", error && error.code ? error.code : String(error.message));
}
try {
  step(Object.assign({}, { reps: 3, state: { reps: { "1": {}, "2": {}, "3": {} }, pending: [], healed: [], applied: [] },
    events: [{ id: 1, kind: "repair", rep: "1", key: "k9" }], budget: 1 }));
  emit("账外修复报码", "没有报错");
} catch (error) {
  emit("账外修复报码", error && error.code ? error.code : String(error.message));
}
try {
  step(Object.assign({}, { reps: 3, state: { reps: { "1": {}, "2": {}, "3": {} }, pending: [], healed: [], applied: [] },
    events: [{ id: 1, kind: "read", key: "k9", from: ["1", "2"] }], budget: 1 }));
  emit("无值可读报码", "没有报错");
} catch (error) {
  emit("无值可读报码", error && error.code ? error.code : String(error.message));
}
try {
  step(Object.assign({}, { reps: 3, state: { reps: { "1": {}, "2": {}, "3": {} }, pending: [], healed: [], applied: [] },
    events: [{ id: 1, kind: "peek", key: "k1" }], budget: 1 }));
  emit("事件不合法报码", "没有报错");
} catch (error) {
  emit("事件不合法报码", error && error.code ? error.code : String(error.message));
}


// ---- 期望值（参考模型算出，与题面给的验收数值一致）----
const EXPECTED = {
  "读结果序列": [
    1,
    1,
    1,
    2
  ],
  "收尾后每键各副本版本": [
    [
      "k1",
      2,
      2,
      2
    ],
    [
      "k2",
      1,
      1,
      1
    ]
  ],
  "收尾后副本一致": true,
  "首轮修复条数": 1,
  "二档修复条数": 3,
  "两个预算档修复不同": true,
  "收尾前待修复账": 2,
  "压在账上的请求": [
    7,
    10
  ],
  "收尾补齐条数": 2,
  "收尾后待修复账": 0,
  "拆两轮中间态不同": true,
  "拆两轮收尾态一致": true,
  "重放新增修复": 0,
  "工作计数未超上界": true,
  "与全量对照差异": 0,
  "确认不足报码": "E_NO_QUORUM",
  "账外修复报码": "E_NOT_PENDING",
  "无值可读报码": "E_UNKNOWN_KEY",
  "事件不合法报码": "E_BAD_EVENT"
};
// 有的值在收进来之前已经 stringify 过，比较前先试着解析回来，避免类型错配把正确实现判成不过。
function __same(got, want) {
  if (typeof got === "string") {
    try { const parsed = JSON.parse(got); if (JSON.stringify(parsed) === JSON.stringify(want)) return true; } catch (error) { /* 不是 JSON 就按原文比 */ }
  }
  return JSON.stringify(got) === JSON.stringify(want);
}
let __bad = 0;
for (const [label, want] of Object.entries(EXPECTED)) {
  const found = __lines.find((pair) => pair[0] === label);
  if (!found) { __bad += 1; console.log("缺失验收项 " + label); continue; }
  const got = found[1];
  if (__same(got, want)) { console.log("一致 " + label + " = " + JSON.stringify(got)); }
  else { __bad += 1; console.log("不一致 " + label + " 期望 " + JSON.stringify(want) + " 实际 " + JSON.stringify(got)); }
}
console.log("验收项 " + (Object.keys(EXPECTED).length - __bad) + "/" + Object.keys(EXPECTED).length + " 通过");
process.exit(__bad === 0 ? 0 : 1);
