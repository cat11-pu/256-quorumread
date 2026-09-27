// quorum.js：法定数与读最高版本
export function quorumOf(size) {
  return Math.floor(Number(size) / 2) + 1;
}

export function readQuorum(store, repIds, key) {
  const table = store || {};
  let version = null;
  for (const rep of repIds) {
    const entries = table[rep];
    if (entries && Object.prototype.hasOwnProperty.call(entries, key)) {
      const value = entries[key];
      if (version === null || value > version) version = value;
    }
  }
  if (version === null) return { version: 0, lagging: [] };
  const lagging = [];
  for (const rep of repIds) {
    const entries = table[rep];
    if (!entries || !Object.prototype.hasOwnProperty.call(entries, key) || entries[key] < version) {
      lagging.push(rep);
    }
  }
  return { version: version, lagging: lagging };
}
