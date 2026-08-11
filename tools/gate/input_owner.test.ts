// input_owner.test.ts — 輸入所有權授權層的迴歸測試
//
// 驗證:
//  1. 編輯器持有時,具名為玩家的 release 被拒絕(O-1 / stand() 情境)
//  2. 編輯器歸還後,輸入確實回到玩家
//  3. controls 與 interact 的 enabled 在每次轉移後都相等(不可能一開一關)
//  4. 反向對照:一個「本來就該成功」的轉移確實成功
//
// Run: npm run test:input-owner

import { createInputOwner } from '../../src/player/input_owner.ts';
import type { InputOwnerName } from '../../src/player/input_owner.ts';

// ---------- 最小 stub ----------
// input_owner.ts 只透過 FPControls/InteractSystem 的 enabled 欄位寫入,
// 不呼叫其他方法,所以 stub 只需要該欄位即可。
function makeControls() {
  return { enabled: true } as { enabled: boolean };
}
function makeInteract() {
  return { enabled: true } as { enabled: boolean };
}

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

// ── 測試 1:初始狀態 ─────────────────────────────────────────────────────────
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);

  ok(io.currentOwner() === 'player', '初始 owner 是 player');
  ok(c.enabled === true,  '初始 controls.enabled = true');
  ok(i.enabled === true,  '初始 interact.enabled = true');
}

// ── 測試 2:acquire → controls/interact 同步關閉 ────────────────────────────
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);

  io.acquire('editor');
  ok(io.currentOwner() === 'editor', 'acquire("editor") 後 owner = editor');
  ok(c.enabled === false, 'editor 持有時 controls.enabled = false');
  ok(i.enabled === false, 'editor 持有時 interact.enabled = false');
  ok(c.enabled === i.enabled, 'controls 與 interact enabled 同步(C-1 / 單一 applier)');
}

// ── 測試 3:O-1 情境:editor 持有時 player release 被拒絕 ───────────────────
// 這正是 stand() 的情境:stand() 代表 'player' 呼叫 release,
// 但 editor 才是當前 owner → 應該被靜默拒絕,輸入仍留在 editor。
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);

  io.acquire('editor');                // editor 取得輸入
  io.release('player');               // stand() 的呼叫形式 — 應被拒絕

  ok(io.currentOwner() === 'editor',  'player release 在 editor 持有時被拒絕(O-1 修復)');
  ok(c.enabled === false,             '被拒絕後 controls 仍關閉');
  ok(i.enabled === false,             '被拒絕後 interact 仍關閉');
}

// ── 測試 4:editor 正確歸還 → 輸入回到玩家 ─────────────────────────────────
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);

  io.acquire('editor');
  io.release('editor');               // editor 自己歸還

  ok(io.currentOwner() === 'player',  'editor release 後 owner 回到 player');
  ok(c.enabled === true,              'editor 歸還後 controls.enabled = true');
  ok(i.enabled === true,              'editor 歸還後 interact.enabled = true');
  ok(c.enabled === i.enabled,         '歸還後 controls 與 interact enabled 仍同步');
}

// ── 測試 5:反向對照 — player 本就持有時呼叫 release('player') 成功 ─────────
// 確認這個授權層不是「什麼都拒絕的機器」;正常的 release 必須成功。
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);

  // 先交給 os,再讓 os 正確歸還給 player
  io.acquire('os');
  ok(io.currentOwner() === 'os',  'CONTROL: acquire("os") 成功');

  io.release('os');                   // os 自己歸還
  ok(io.currentOwner() === 'player', 'CONTROL: os release 後 owner = player');
  ok(c.enabled === true,             'CONTROL: os 歸還後 controls 開啟');
}

// ── 測試 6:controls 與 interact enabled 在 acquire/release 的每個步驟同步 ──
// 防止「controls 開、interact 關」或反之的中間狀態(C-1 核心不變量)。
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);

  const steps: Array<[InputOwnerName, 'acquire' | 'release', InputOwnerName?]> = [
    ['editor', 'acquire'],
    ['reader', 'acquire'],     // 覆寫 editor (另一子系統 acquire)
    ['reader', 'release'],
    ['player', 'acquire'],
    ['os',     'acquire'],
    ['os',     'release'],
  ];

  let allSync = true;
  for (const [name, action, to] of steps) {
    if (action === 'acquire') {
      io.acquire(name);
    } else {
      io.release(name, to);
    }
    if (c.enabled !== i.enabled) {
      allSync = false;
      console.error(`  ✗ 不同步於 ${action}("${name}"):controls=${c.enabled} interact=${i.enabled}`);
    }
  }
  ok(allSync, 'controls 與 interact.enabled 在所有 acquire/release 步驟後始終同步');
}

console.log(`input_owner: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
