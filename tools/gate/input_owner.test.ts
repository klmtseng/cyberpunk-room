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
import { resolveHandbackTarget } from '../../src/player/editor_handback.ts';
import type { OverlayLiveness } from '../../src/player/editor_handback.ts';

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
  io.release('player', 'player');      // stand() 的呼叫形式 — 應被拒絕

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
  io.release('editor', 'player');     // editor 自己歸還

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

  io.release('os', 'player');         // os 自己歸還
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
    ['reader', 'acquire'],              // 覆寫 editor (另一子系統 acquire)
    ['reader', 'release', 'player'],
    ['player', 'acquire'],
    ['os',     'acquire'],
    ['os',     'release', 'player'],
  ];

  let allSync = true;
  for (const [name, action, to] of steps) {
    if (action === 'acquire') {
      io.acquire(name);
    } else {
      io.release(name, to!);
    }
    if (c.enabled !== i.enabled) {
      allSync = false;
      console.error(`  ✗ 不同步於 ${action}("${name}"):controls=${c.enabled} interact=${i.enabled}`);
    }
  }
  ok(allSync, 'controls 與 interact.enabled 在所有 acquire/release 步驟後始終同步');
}

// ── 測試 7:歸還對象是必填的 ────────────────────────────────────────────────
// release() 曾經有 to = 'player' 的預設值,讓「無條件還給 player」這個假設
// 藏在簽名裡。現在移除了預設值,四個呼叫端都必須明講還給誰。
// 這裡用 arity 確認簽名本身,而不是靠呼叫端的寫法間接推斷。
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);

  ok(io.release.length === 2, 'release() 有兩個必填參數(to 沒有預設值)');
}

// ── 測試 8:handback 政策 — 原 owner 仍在台上就還給它 ──────────────────────
// 這一組直接測 resolveHandbackTarget 的每一個分支。arcade 與 reader 的
// keydown 是 capture 且會 stopPropagation,所以它們持有輸入時 F2 到不了
// 編輯器,實務上不會成為 previousOwner——但政策仍然覆蓋它們,所以這裡用
// focused test 驗證兩個分支,不主張這兩條序列曾在真實 UI 跑過。
{
  const ALL_LIVE:  OverlayLiveness = { os: true,  arcade: true,  reader: true  };
  const NONE_LIVE: OverlayLiveness = { os: false, arcade: false, reader: false };

  ok(resolveHandbackTarget('player', NONE_LIVE) === 'player',
     'player 永遠有效(不受 overlay 狀態影響)');
  ok(resolveHandbackTarget('player', ALL_LIVE) === 'player',
     'player 永遠有效(overlay 全開時也一樣)');

  ok(resolveHandbackTarget('os', { ...NONE_LIVE, os: true }) === 'os',
     'os 仍開啟 → 還給 os');
  ok(resolveHandbackTarget('os', { ...ALL_LIVE, os: false }) === 'player',
     'os 已關閉 → 退回 player(避免 stale-owner 軟鎖死)');

  ok(resolveHandbackTarget('arcade', { ...NONE_LIVE, arcade: true }) === 'arcade',
     'arcade 仍 active → 還給 arcade');
  ok(resolveHandbackTarget('arcade', { ...ALL_LIVE, arcade: false }) === 'player',
     'arcade 已 inactive → 退回 player');

  ok(resolveHandbackTarget('reader', { ...NONE_LIVE, reader: true }) === 'reader',
     'reader 仍開啟 → 還給 reader');
  ok(resolveHandbackTarget('reader', { ...ALL_LIVE, reader: false }) === 'player',
     'reader 已關閉 → 退回 player');

  ok(resolveHandbackTarget('editor', ALL_LIVE) === 'player',
     'editor 不可能是自己的前一手 → 退回 player');

  // 交叉檢查:判斷只看自己那一格,不會被別的 overlay 影響。
  ok(resolveHandbackTarget('os', { os: false, arcade: true, reader: true }) === 'player',
     'os 失效時不會因為 arcade/reader 還開著就誤判為有效');
}

// ── 測試 9:序列 — player → editor → player ────────────────────────────────
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);
  const live: OverlayLiveness = { os: false, arcade: false, reader: false };

  const prev = io.currentOwner();                     // adapter.acquire() 記錄
  ok(prev === 'player', 'S1: 開啟前 owner = player');
  io.acquire('editor');
  ok(c.enabled === false && i.enabled === false, 'S1: 編輯器持有時兩者皆關');

  io.release('editor', resolveHandbackTarget(prev, live));   // adapter.release()
  ok(io.currentOwner() === 'player', 'S1: 關閉後 owner = player');
  ok(c.enabled === true,  'S1: 關閉後 controls 恢復');
  ok(i.enabled === true,  'S1: 關閉後 interact 恢復');
}

// ── 測試 10:序列 — os 開啟 → editor → editor off → 仍是 os → Escape → player ──
// OS 在編輯器關閉之後才退場的正常路徑:輸入必須先回到 os(overlay 還在,
// 玩家不該能動),等 os 自己退場時才回到 player。
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);
  const live: OverlayLiveness = { os: true, arcade: false, reader: false };

  io.acquire('os');                                   // jack-in
  ok(io.currentOwner() === 'os', 'S2: os 取得輸入');

  const prev = io.currentOwner();
  io.acquire('editor');                               // F2 on(OS 不擋 F2)
  io.release('editor', resolveHandbackTarget(prev, live));   // F2 off,os 仍開著

  ok(io.currentOwner() === 'os', 'S2: 編輯器關閉後輸入回到 os,不是 player');
  ok(c.enabled === false, 'S2: os 仍持有時 controls 維持關閉');
  ok(i.enabled === false, 'S2: os 仍持有時 interact 維持關閉');

  io.release('os', 'player');                         // Escape → os.onExit
  ok(io.currentOwner() === 'player', 'S2: os 退場後 owner = player');
  ok(c.enabled === true,  'S2: 最終 controls 恢復');
  ok(i.enabled === true,  'S2: 最終 interact 恢復');
}

// ── 測試 11:序列 — os 開啟 → editor → Escape 關掉 os → editor off → player ──
// 這是本次修復的目標情境。編輯器開著時按 Escape,os.onExit 會呼叫
// release('os','player') 但因為當下 owner 是 'editor' 而被靜默拒絕;
// 若編輯器關閉時照記錄還給 'os',controls 與 interact 會永遠停在關閉狀態
// 而畫面上沒有任何 overlay = 軟鎖死。活性檢查必須把它退回 player。
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);
  const live: OverlayLiveness = { os: true, arcade: false, reader: false };

  io.acquire('os');
  const prev = io.currentOwner();
  io.acquire('editor');                               // F2 on

  // Escape:os 先關掉自己,再呼叫 onExit → release('os','player')
  live.os = false;
  io.release('os', 'player');
  ok(io.currentOwner() === 'editor', 'S3: os 的 release 在 editor 持有時被拒絕');

  // F2 off:此時記錄的 previousOwner 是 'os',但 os 已經退場了
  io.release('editor', resolveHandbackTarget(prev, live));

  ok(io.currentOwner() === 'player', 'S3: 原 owner 已失效 → 退回 player(不是 os)');
  ok(c.enabled === true,  'S3: controls 恢復(沒有軟鎖死)');
  ok(i.enabled === true,  'S3: interact 恢復(沒有軟鎖死,jack-in 仍可用)');
  ok(c.enabled === i.enabled, 'S3: 兩者同步');
}

// ── 測試 12:負向對照 — 若沒有活性檢查,S3 就會軟鎖死 ──────────────────────
// 證明測試 11 不是恆真句:同樣的序列,把活性檢查拿掉(直接還給記錄的
// previousOwner)就會落進鎖死狀態。這條在修復被移除時會失敗。
{
  const c = makeControls();
  const i = makeInteract();
  const io = createInputOwner(c as any, i as any);

  io.acquire('os');
  const prev = io.currentOwner();
  io.acquire('editor');
  io.release('os', 'player');            // 被拒絕
  io.release('editor', prev);            // ← 無活性檢查的舊行為

  ok(io.currentOwner() === 'os',  'NEG: 無活性檢查時 owner 停在已退場的 os');
  ok(c.enabled === false,         'NEG: 無活性檢查時 controls 被鎖住');
  ok(i.enabled === false,         'NEG: 無活性檢查時 interact 被鎖住(這正是要避免的)');
}

console.log(`input_owner: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
