/**
 * 輸入所有權授權層 (Input Ownership Authorization Layer)
 *
 * 「誰擁有玩家輸入」的唯一事實來源。
 *
 * 設計原則:
 *  - 單一 applier:只有 _apply() 會寫入 controls.enabled 與 interact.enabled,
 *    兩者永遠同進同出。
 *  - 取得要具名、歸還也要具名:release() 只有在自己確實是當前 owner 時才生效,
 *    其他持有者的 release 不能把輸入從你手上搶走。
 *  - 不用「快照再還原」:所有權用 owner 身分表達,不是數值快照。
 *  - 本層不認識任何 overlay:它不知道 os / arcade / reader 是什麼,
 *    也不判斷歸還對象現在還活著沒有。那是 composition layer(main.ts)的事,
 *    因為只有那裡同時看得到所有 overlay 的狀態。本層只做記帳。
 *
 * 使用方式:
 *   const io = createInputOwner(controls, interact);
 *   io.acquire('player');            // 玩家取得輸入
 *   io.acquire('editor');            // 編輯器取得輸入(玩家自動失去)
 *   io.release('editor', 'player');  // 只有 editor 自己能還輸入,且要指名還給誰
 *   io.release('player', 'player');  // 此時 editor 持有中 → 無作用(被拒絕)
 */

import type { FPControls } from './fp-controls.ts';
import type { InteractSystem } from './interact.ts';

/** 可以取得輸入所有權的具名子系統 */
export type InputOwnerName = 'player' | 'editor' | 'os' | 'arcade' | 'reader';

export interface InputOwner {
  /** 宣告取得輸入所有權;前一個 owner 的所有權立即終止 */
  acquire(name: InputOwnerName): void;
  /**
   * 歸還輸入所有權給指定的後繼者。
   * release() 只有在 `from` 確實是當前 owner 時才生效;
   * 若 `from` 不是當前 owner,此呼叫被靜默拒絕。
   *
   * `to` 是必填的:沒有預設值。歸還對象由呼叫端決定,因為只有呼叫端
   * 知道自己是疊在誰上面、以及那個人現在還在不在。本層刻意不猜。
   */
  release(from: InputOwnerName, to: InputOwnerName): void;
  /** 讀取目前持有輸入的子系統名稱 */
  currentOwner(): InputOwnerName;
}

/**
 * 玩家持有輸入時 controls 與 interact 都開啟;
 * 其他子系統持有時兩者都關閉。
 */
function isPlayerOwned(owner: InputOwnerName): boolean {
  return owner === 'player';
}

/** 唯一寫入 controls.enabled / interact.enabled 的函式 */
function _apply(
  controls: FPControls,
  interact: InteractSystem,
  owner: InputOwnerName,
): void {
  const enabled = isPlayerOwned(owner);
  controls.enabled = enabled;
  interact.enabled = enabled;
}

export function createInputOwner(
  controls: FPControls,
  interact: InteractSystem,
): InputOwner {
  let _owner: InputOwnerName = 'player';

  return {
    acquire(name: InputOwnerName): void {
      _owner = name;
      _apply(controls, interact, _owner);
    },

    release(from: InputOwnerName, to: InputOwnerName): void {
      // 只有當前 owner 才能歸還;否則靜默拒絕。
      // 這正是讓 stand() 在編輯器持有時被擋下的機制:
      // stand() 代表 'player' 呼叫 release('player')——但 editor 才是當前 owner,
      // 所以 from !== _owner → 呼叫無效。
      if (from !== _owner) return;
      _owner = to;
      _apply(controls, interact, _owner);
    },

    currentOwner(): InputOwnerName {
      return _owner;
    },
  };
}
