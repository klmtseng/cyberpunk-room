/**
 * editor_handback.ts — 編輯器關閉時該把輸入還給誰。
 *
 * 為什麼需要這個判斷:
 *   編輯器關閉時應該還給「開啟前的那個 owner」,而不是無條件還給 player
 *   ——否則在 OS 開著時開關編輯器,玩家會在 overlay 還在的情況下拿回移動權。
 *
 *   但原 owner 可能在編輯器開著的期間就退場了。CyberOS 的 keydown (os.ts:133)
 *   是 bubble 且不 stopPropagation,所以編輯器開著時按 Escape 會關掉 OS,而
 *   os.onExit 的 release('os','player') 因為當下 owner 是 'editor' 而被靜默拒絕。
 *   此時若照記錄把輸入還給 'os',controls 與 interact 都會停在關閉狀態、
 *   畫面上卻沒有任何 overlay = 軟鎖死,連 jack-in 都做不到(enterOS 掛在 interact
 *   上),只能重整頁面。
 *
 * 因此:歸還前先看原 owner 還在不在台上,不在就退回 player。
 *
 * 這個函式刻意是純的——它不 import 任何 overlay,只接受呼叫當下的狀態快照。
 * 讀取真實狀態(os.isOpen / arcade.isActive / reader.isOpen)是 composition
 * layer(main.ts)的責任,因為只有那裡同時看得到這三者。InputOwner 則完全
 * 不參與這個判斷:它只負責記帳。
 */

import type { InputOwnerName } from './input_owner.ts';

/**
 * 各 overlay 目前是否仍在台上。
 * 由 composition layer 在呼叫的當下同步取樣,不保存、不快取。
 */
export interface OverlayLiveness {
  os: boolean;
  arcade: boolean;
  reader: boolean;
}

/**
 * 給定編輯器開啟前的 owner 與當下的 overlay 狀態,回傳應該歸還的對象。
 *
 * 規則:原 owner 仍在台上就還給它;已經退場就退回 'player'。
 * 'player' 永遠有效;'editor' 不可能是自己的前一手,一律視為失效。
 */
export function resolveHandbackTarget(
  previousOwner: InputOwnerName,
  live: OverlayLiveness,
): InputOwnerName {
  switch (previousOwner) {
    case 'player': return 'player';
    case 'os':     return live.os     ? 'os'     : 'player';
    case 'arcade': return live.arcade ? 'arcade' : 'player';
    case 'reader': return live.reader ? 'reader' : 'player';
    case 'editor': return 'player';
  }
}
