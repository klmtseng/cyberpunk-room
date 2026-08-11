// override_merge.test.ts — 迴歸測試 H10 / O-3:存檔時走訪所有實體
//
// 驗證:
//  1. 核心迴歸:A、B 都移動,只選取 B 存檔,A 與 B 的 override 都在
//  2. 未被移動的實體不會產生 override 條目
//  3. 原本有 override、移回 authored 位置的實體,其條目被移除
//  4. orphan 保留:existing 裡不在註冊表的 id 被原樣保留
//  5. 只有 position 變、rotation/scale 未變時,entry 只含 position 一個鍵
//  6. 反向對照:什麼都沒變的輸入,結果與 existing 相等
//
// Run: npm run test:override-merge

import { computeOverrides } from '../../src/editor/override_merge.ts';
import type { OverrideEntry, ObjectTransform } from '../../src/editor/override_merge.ts';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('  ✗ FAIL:', msg);
  }
}

// ── 共用工具 ─────────────────────────────────────────────────────────────────

function identity(): ObjectTransform {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale:    [1, 1, 1],
  };
}

function moved(dx: number, dy: number, dz: number): ObjectTransform {
  return {
    position: [dx, dy, dz],
    rotation: [0, 0, 0],
    scale:    [1, 1, 1],
  };
}

// ── 測試 1:核心迴歸 H10 ──────────────────────────────────────────────────────
// A 和 B 都被移動;只「選取」B 但要兩個 override 都被寫入。
{
  const authored: Record<string, ObjectTransform> = {
    A: identity(),
    B: identity(),
  };
  const current: Record<string, ObjectTransform> = {
    A: moved(1, 0, 0),
    B: moved(0, 2, 0),
  };

  const result = computeOverrides(
    {},
    ['A', 'B'],
    (id) => current[id],
    (id) => authored[id],
  );

  ok('A' in result, 'H10:A 的 override 存在');
  ok('B' in result, 'H10:B 的 override 存在');
  ok(result['A']?.position?.[0] === 1, 'H10:A.position[0] = 1');
  ok(result['B']?.position?.[1] === 2, 'H10:B.position[1] = 2');
}

// ── 測試 2:未被移動的實體不產生 override ────────────────────────────────────
{
  const t = identity();
  const result = computeOverrides(
    {},
    ['C'],
    (_id) => ({ ...t }),
    (_id) => ({ ...t }),
  );
  ok(!('C' in result), '未移動實體不在 result 中');
  ok(Object.keys(result).length === 0, 'result 為空物件');
}

// ── 測試 3:移回 authored 位置的實體,條目被移除 ───────────────────────────────
{
  const existing: Record<string, OverrideEntry> = {
    D: { position: [5, 5, 5] },
  };
  // 現在 D 的 position 已回到 authored(0,0,0)
  const result = computeOverrides(
    existing,
    ['D'],
    (_id) => identity(),
    (_id) => identity(),
  );
  ok(!('D' in result), '移回 authored 後 D 的條目被刪除');
}

// ── 測試 4:orphan 保留 ───────────────────────────────────────────────────────
// existing 裡有一個 id 不在 editableIds 中,應原樣保留。
{
  const existing: Record<string, OverrideEntry> = {
    ORPHAN: { position: [9, 9, 9] },
  };
  const result = computeOverrides(
    existing,
    [],   // 空的 editableIds — ORPHAN 不在其中
    (_id) => undefined,
    (_id) => undefined,
  );
  ok('ORPHAN' in result, 'orphan 條目被保留');
  ok(result['ORPHAN']?.position?.[0] === 9, 'orphan.position[0] = 9');
}

// ── 測試 5:只有 position 變,entry 只含 position 一個鍵 ──────────────────────
{
  const authored: ObjectTransform = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale:    [1, 1, 1],
  };
  const current: ObjectTransform = {
    position: [3, 0, 0],  // 只有 position 變
    rotation: [0, 0, 0],
    scale:    [1, 1, 1],
  };
  const result = computeOverrides(
    {},
    ['E'],
    (_id) => current,
    (_id) => authored,
  );
  ok('E' in result, 'E 有 override');
  ok('position' in (result['E'] ?? {}), 'E 含 position 鍵');
  ok(!('rotation' in (result['E'] ?? {})), 'E 不含 rotation 鍵');
  ok(!('scale' in (result['E'] ?? {})), 'E 不含 scale 鍵');
  ok(Object.keys(result['E'] ?? {}).length === 1, 'E 的 entry 只有 1 個鍵');
}

// ── 測試 6:反向對照 — 什麼都沒變,result 與 existing 等價 ───────────────────
{
  const existing: Record<string, OverrideEntry> = {
    F: { position: [1, 2, 3] },
  };
  // F 在 existing 裡有 override,但現在的 current 已回到 authored
  // → F 的條目應被移除
  // 另外 editableIds 空,代表沒有任何可走訪的實體
  const resultEmpty = computeOverrides(
    {},
    [],
    (_id) => undefined,
    (_id) => undefined,
  );
  ok(Object.keys(resultEmpty).length === 0, '反向對照:空輸入產生空輸出');

  // existing 有 ORPHAN(不在 editableIds),走訪後仍保留
  const existingOrphan: Record<string, OverrideEntry> = {
    ORPHAN2: { rotation: [0.1, 0, 0] },
  };
  const resultOrphan = computeOverrides(
    existingOrphan,
    [],
    (_id) => undefined,
    (_id) => undefined,
  );
  ok(JSON.stringify(resultOrphan) === JSON.stringify(existingOrphan),
    '反向對照:只有 orphan 的 existing 不被改變');
}

console.log(`override_merge: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
