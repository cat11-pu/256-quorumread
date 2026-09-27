// quorum.js：法定数与读最高版本（基线：一律给零）
export function quorumOf(size) {
  return 0;
}

export function readQuorum(store, repIds, key) {
  return { version: 0, lagging: [] };
}
