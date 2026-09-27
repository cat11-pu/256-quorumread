// quorum.js：法定数与读最高版本
export function quorumOf(size) {
  return Math.floor(Number(size) / 2) + 1;
}

// 在响应副本集里取最高版本；缺键按 0 计，低于最高版本的响应者进落后清单。
// 全部响应者都没有该键时 version 为 0（由调用方报 E_UNKNOWN_KEY）。
export function readQuorum(store, repIds, key) {
  const reps = store || {};
  const ids = Array.isArray(repIds) ? repIds : [];
  let version = 0;
  for (const rep of ids) {
    const seen = Number(reps[rep] && reps[rep][key]) || 0;
    if (seen > version) version = seen;
  }
  const lagging = [];
  if (version > 0) {
    for (const rep of ids) {
      const seen = Number(reps[rep] && reps[rep][key]) || 0;
      if (seen < version) lagging.push(rep);
    }
  }
  return { version, lagging };
}
