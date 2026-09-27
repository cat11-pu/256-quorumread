// repairrun.js：按修复预算修账并留账（基线：一律给空表）
import { quorumOf, readQuorum } from "./quorum.js";

export function step(spec) {
  return { state: spec.state, reads: [], healed: [], healed_count: 0,
           pending: 0, pending_ids: [], judged: 0, judged_bound: 0 };
}

export function close(spec) {
  return { state: spec.state, catchup: 0 };
}
