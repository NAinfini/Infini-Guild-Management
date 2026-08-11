import { readFile } from "node:fs/promises";
import {
  originForSlot,
  RUN_STATE_FILE,
  stateFileFor,
  type E2eRunStateFile,
  type SiteFingerprint,
} from "./support/config";
import {
  cleanupSystemTestRun,
  diffFingerprints,
  formatDrift,
  newApiContext,
} from "./support/api";
import { readSlotFingerprint } from "./support/fingerprint";

/**
 * 收尾即验收：每个槽位各自先让服务端按登记的主键清掉本次运行的产物，
 * 再把本地 D1 全表内容与 R2 对象元数据指纹跟该槽位的基线逐项对齐。
 *
 * 对不上就抛错让整轮变红；不得在收尾阶段重种来掩盖残留。
 */
async function verifySlot(slot: number, runId: string, baseline: SiteFingerprint): Promise<string | null> {
  const origin = originForSlot(slot);
  const adminApi = await newApiContext(stateFileFor("admin", slot), origin);
  try {
    await cleanupSystemTestRun(adminApi, runId);
    const drift = diffFingerprints(baseline, await readSlotFingerprint(slot));
    return drift.length === 0 ? null : `槽位 ${slot}（${origin}）:\n${formatDrift(drift)}`;
  } finally {
    await adminApi.dispose();
  }
}

async function globalTeardown(): Promise<void> {
  let serialized: string;
  try {
    serialized = await readFile(RUN_STATE_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const state = JSON.parse(serialized) as E2eRunStateFile;

  /*
   * 逐个槽位都要走完再汇总。某个槽位有残留就提前抛的话，后面那些槽位
   * 既不会被清理、残留也不会被报出来——一次跑完只看见一半问题。
   */
  const results = await Promise.allSettled(
    state.slots.map((slot, index) => verifySlot(index, slot.runId, slot.baseline)),
  );

  const failures = results.flatMap((result, index) => {
    if (result.status === "rejected") {
      return [`槽位 ${index} 清理失败: ${String(result.reason)}`];
    }
    return result.value ? [result.value] : [];
  });

  if (failures.length > 0) {
    throw new Error(`e2e 结束后站点没有回到基线，说明有测试数据没被清掉：\n${failures.join("\n")}`);
  }
}

export default globalTeardown;
