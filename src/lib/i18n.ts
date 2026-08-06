/**
 * Lightweight i18n module for NEON LOFT.
 * Language resolution order: ?lang=en|zh → localStorage → navigator.language → 'en'.
 * Call t(key) anywhere; call setLang('en'|'zh') to switch at runtime.
 */

export type Lang = 'zh' | 'en';

// ─── Dictionary ──────────────────────────────────────────────────────────────
const dict: Record<Lang, Record<string, string>> = {
  zh: {
    // ── index.html / boot ──
    'lock.desktop': '點擊進入 / CLICK TO JACK IN',
    'lock.keys':
      '<span class="k">WASD</span> 移動 ·\n        <span class="k">滑鼠</span> 視角 ·\n        <span class="k">Shift</span> 跑 ·\n        <span class="k">E</span> 互動 ·\n        <span class="k">ESC</span> 離開',
    'lock.touch': '點任意處進入 NEON LOFT',
    'lock.touch.keys':
      '<span class="k">左下搖桿</span> 移動 · <span class="k">滑動</span> 視角 · <span class="k">點一下</span> 互動',
    'touchhint': '滑動視角 · 點一下互動 · 左下搖桿移動',

    // ── GPU fail overlay ──
    'gpu.title': 'GPU DRIVER INCOMPATIBLE',
    'gpu.body': '此瀏覽器的 GPU 後端無法編譯 shader（常見於 Chrome + 舊款 Intel 內顯）。<br/>請改用 <b style="color:#5af2ff">Firefox</b> 開啟本頁，即可正常遊玩。',

    // ── interact prompts ──
    'prompt.barLantern.on': '熄滅馬賽克燈籠',
    'prompt.barLantern.off': '點亮馬賽克燈籠',
    'flash.barLantern.on': '🪔 馬賽克燈籠點亮 — 彩繪玻璃',
    'flash.barLantern.off': '🪔 燈籠熄滅',

    'prompt.deskLantern': '土耳其檯燈 — 切換亮度',
    'prompt.deskLantern.off': '亮一級',
    'prompt.deskLantern.dim': '亮二級',
    'prompt.deskLantern.bright': '熄滅',
    'flash.deskLantern.off': '熄滅',
    'flash.deskLantern.dim': '微亮 (氛圍)',
    'flash.deskLantern.bright': '明亮',
    // flash template: 💡 桌燈 → {level},再按一次:{next}
    'flash.deskLantern.prefix': '💡 桌燈 →',
    'flash.deskLantern.next': '再按一次:',

    'prompt.mosaic': '翻牌馬賽克 — 換一幅',
    'flash.mosaic.prefix': '🖼 馬賽克牆 →',

    'prompt.monitor': '接入 CyberOS',
    'prompt.tv': '空間投影',
    'prompt.tv.screen': '切換頻道',
    'flash.tv.stop': '📽 投影結束',
    'flash.tv.cast': '📽 投影:',
    'flash.tv.resume': '▶ 續播',
    'flash.tv.pause': '⏸ 暫停',

    'prompt.neon': '切換霓虹色',
    'prompt.record': '播放黑膠 (合成器墊音)',
    'flash.record.on': '♫ 黑膠轉動中…',
    'flash.record.off': '黑膠停止',

    'prompt.window': '切換雨勢',
    'flash.rain.prefix': '🌧 雨勢:',

    'prompt.bar': '調一杯酒',
    'flash.bar': '🍸 NEON COLA + 合成龍舌蘭…乾杯!',

    'prompt.sofa': '坐下 (電動沙發)',
    'flash.sofa.sit': '已就座 — 滑鼠左右看 · [R] 椅背 · [M] 按摩 · 移動鍵起身',
    'flash.stand': '起身',
    'flash.recline.on': '⚙ 椅背放平 — 看看高樓上的雨',
    'flash.recline.off': '⚙ 椅背豎直',
    'flash.massage.on': '〰 按摩模式 8 秒',
    'flash.massage.off': '按摩停止',

    'prompt.bed': '小睡片刻',
    'flash.bed.drunk': '…睡了一會兒,酒醒了',
    'flash.bed.normal': '…睡了一會兒,窗外的雨還沒停',

    'prompt.lights': '燈光情境',
    'flash.lights.prefix': '💡 燈光:',

    'prompt.pendants': '吧檯柔光',
    'flash.pendants.on': '🪔 吧檯柔光開啟 — 配馬賽克牆比較不刺眼',
    'flash.pendants.off': '🪔 吧檯柔光熄滅 — 高對比模式',

    'prompt.holo': '全息投影',
    'flash.holo.prefix': '🔮 投影頻道:',

    'prompt.curtain': '電動窗簾',
    'flash.curtain.closing': '🪟 窗簾下降中…',
    'flash.curtain.opening': '🪟 窗簾上升中…',

    'prompt.bookshelf': '藏書架',
    'flash.bookshelf': '📖 看準一本書的書脊按 E,把它取下來讀',
    'prompt.book.prefix': '取下《',
    'prompt.book.suffix': '》',

    'prompt.shardArt': '讀取碎片:重新策展 (全部換畫)',
    'flash.shardArt': '🖼 已向大都會博物館請求新一批館藏…',
    'prompt.shardAudio': '讀取碎片:家庭錄音檔案',
    'prompt.devlogShard': '??? 金色碎片',

    'prompt.frame': '換一幅畫',
    'flash.frame': '🖼 重新策展中…',

    'prompt.bathDoor': '浴室門',
    'flash.bathDoor.open': '🚪 門開啟',
    'flash.bathDoor.close': '🚪 門關閉',
    'prompt.toilet': '沖水',
    'flash.toilet': '🚽 嘩——',
    'prompt.mirror': '智慧鏡',
    'flash.mirror': '🪞 鏡面掃描:外觀評分 SSS — 今晚也很賽博朋克',
    'prompt.shower': '淋浴',
    'flash.shower.on': '🚿 熱水 + 蒸氣中…',
    'flash.shower.off': '🚿 關閉',
    'prompt.washer': '洗衣',
    'flash.washer': '🌀 洗衣行程 20 秒 — 滾筒運轉中',

    'prompt.speaker': '音樂 播放/暫停',
    'flash.speaker.load': '🎧 還沒載入電台 — 幫你開 NeuroSound',
    'flash.speaker.pause': '⏸ 音樂暫停',
    'flash.speaker.play': '▶ 音樂繼續 — 配著窗外的雨剛剛好',

    'prompt.iris': '呼叫 虹 // IRIS',
    'flash.iris.prefix': '🟣 虹:「',
    'flash.iris.suffix': '」',

    'prompt.cat': '摸摸夜貓',
    'flash.cat': '🐈‍⬛ 夜貓:呼嚕嚕嚕…(尾巴拍了拍)',
    'prompt.coffee': '沖一杯咖啡',
    'flash.coffee.brewing': '☕ 合成豆研磨中…(7 秒)',
    'flash.coffee.busy': '☕ 已經在煮了,稍安勿躁',

    'prompt.door': '大門',
    'flash.door.open': '🚪 安全鎖解除 — 門開',
    'flash.door.close': '🚪 門關閉,上鎖',
    'prompt.package': '撿起包裹',

    'prompt.wardrobe': '換裝',
    'flash.wardrobe.prefix': '🧥 義體外裝 →',
    'flash.wardrobe.suffix': '(去浴室照照鏡子)',

    'prompt.projector': '床頭星空儀',
    'flash.projector.prefix': '✨ 星空儀 →',

    'prompt.pickup.prefix': '拿起 ',
    'flash.pickup.held': '✋ 拿著「',
    'flash.pickup.held.suffix': '」— [F] 放下 · [Q] 放回原位',
    'flash.pickup.drop': '📍 「',
    'flash.pickup.drop.suffix': '」放在這',
    'flash.pickup.return': '↩ 「',
    'flash.pickup.return.suffix': '」放回原位',

    'prompt.fridge': '打開冰箱',
    'flash.fridge.open': '🧊 NEON COLA × 5 + 神秘紫色瓶子 + 鄰居的塑膠花',
    'flash.fridge.close': '🚪 冰箱關起來',

    'prompt.dnd': '勿擾模式 (DND) 切換',
    'flash.dnd.on': '🔇 勿擾模式 — 門鈴會被靜音,包裹仍在門口累積',
    'flash.dnd.off': '🔔 接受訪客 — 累積的包裹會在下次門鈴釋出',

    'flash.doorbell': '🔔 門鈴 — 有人放了東西在門口',
    'flash.doorbell.missed': '🔔 門鈴 — 趁你不在的時候有東西到了',

    'prompt.arcade.screen': '投幣開玩 NEON BREAKER',
    'prompt.arcade.shell': '投幣開玩 NEON BREAKER',
    'flash.arcade.leave': '離開街機 — 下次再來破紀錄',

    'flash.cyberos.vr': '⏏ CyberOS 在 VR 暫不可用 (DOM 介面)',

    // ── floor plan ──
    'plan.title': 'FLOOR PLAN ▸ NEON LOFT',
    'plan.info.prefix': '房間 ',
    'plan.info.mid': 'm × ',
    'plan.info.suffix': 'm  ·  顯示物件 ',
    'plan.info.end': ' 件  ·  P 或 term plan 切回 3D',
    'plan.legend.wall': '牆/結構',
    'plan.legend.furniture': '家具',
    'plan.legend.interactive': '可互動',
    'plan.legend.pickable': '可拿取',
    'plan.legend.prop': '雜物',

    // ── bookreader ──
    'book.loading': '擷取書頁中…',
    'book.error': '⛔ 圖書館連線失敗',
    'book.footer.read': '— 全書完 —',
    'book.footer.nav': '%  ·  [A/D] 翻頁  [E] 闔上',

    // ── audit report strings (produced by formatAuditReport in main.ts) ──
    'audit.pass': '> 物件配置稽核 ✓ 全部通過 (沒有埋牆 / 浮空 / 重大重疊)',
    'audit.head.prefix': '> 物件配置稽核 — 共發現 ',
    'audit.head.suffix': ' 項異常:',
    'audit.more.prefix': '  …還有 ',
    'audit.more.suffix': ' 項。完整清單在瀏覽器 console: window.neon.audit()',

    // ── cast pipeline ──
    'flash.cast.wall.fail': '⛔ 馬賽克牆尚未載入',
    'flash.cast.wall': '📡 投影到馬賽克牆 — 28×5 LED 面板',
    'flash.cast.wall.done': '📡 已投影到馬賽克牆 — 回廚房看',
    'flash.cast.tv': '📽 投影展開 — 回客廳看吧,影片浮在半空',
    'flash.cast.tv.done': '📽 已投影到客廳 — ESC 出去邊走邊看',
    'flash.cast.fail.prefix': '⛔ 投影失敗:',

    // ── thunder ──
    'flash.thunder': '⚡ 閃電 + 滾雷,雨聲短暫減弱',

    // ── IRIS lines ──
    'iris.0': '夜城的雨,下得比你的截止日還準時。',
    'iris.1.a': '外面的真實世界:',
    'iris.1.b': '。窗外這場雨倒是我們自己選的。',
    'iris.1.no': '定位資料還沒回來,不過依我看,哪裡都在下雨。',
    'iris.2': '你的咖啡因攝取量已超標。要我假裝沒看到,還是再煮一杯?',
    'iris.3': '夜貓今天換了三個睡覺位置。牠的日程比你充實。',
    'iris.4': '提醒:你已經盯著城市看了一陣子了。這不是壞事,我只是記錄一下。',
    'iris.5': '雨太大了嗎?我把它調小一點。…好了。',
    'iris.time.prefix': '現在時間 ',
    'iris.time.h': ' 點 ',
    'iris.time.m': ' 分。',

    // ── lighting moods ──
    'mood.standard': '標準',
    'mood.reading': '閱讀',
    'mood.cinema': '影院',
    'mood.party': '派對',
    'mood.dark': '全暗',

    // ── WMO weather descriptions ──
    'wmo.clear': '晴',
    'wmo.partly': '多雲時晴',
    'wmo.overcast': '陰',
    'wmo.fog': '霧',
    'wmo.drizzle': '毛毛雨',
    'wmo.rain': '雨',
    'wmo.snow': '雪',
    'wmo.showers': '陣雨',
    'wmo.thunderstorm': '雷雨',

    // ── CyberOS Terminal ──
    'term.boot': 'CyberOS NeoTerm — 輸入 help 查看指令',
    'term.help.env': '── 環境 / 氛圍 ──',
    'term.help.lights': '── 燈具 ──',
    'term.help.visual': '── 視覺裝置 ──',
    'term.help.atmo': '── 大氣 / 電影感 ──',
    'term.help.av': '── 影音投影 ──',
    'term.help.gallery': '── 藝廊 / 圖書 ──',
    'term.help.sys': '── 系統 / 彩蛋 ──',
    'term.help.weather': 'weather <off|light|heavy>   控制窗外雨勢',
    'term.help.curtain': 'curtain                     電動窗簾升/降',
    'term.help.neon': 'neon                        切換窗邊霓虹燈色',
    'term.help.light': 'light                       燈光情境 (標準/閱讀/影院/派對/全暗)',
    'term.help.dnd': 'dnd / quiet                 勿擾模式 — 門鈴靜音(包裹仍累積)',
    'term.help.lantern': 'lantern                     吧檯馬賽克燈籠 開/關',
    'term.help.desklamp': 'desklamp                    桌上土耳其檯燈 三段:熄/微亮/明亮',
    'term.help.wash': 'wash / pendant              吧檯柔光吊燈 開/關',
    'term.help.mosaic': 'mosaic                      翻牌馬賽克牆 換一幅 (14 幅藝術品輪播)',
    'term.help.holo': 'holo                        茶几全息小投影 切換 (球/迷你城/寶石)',
    'term.help.ad': 'ad                          天際線插播一支全息廣告',
    'term.help.iris': 'iris                        虹 (IRIS) 全息助理說一句',
    'term.help.flicker': 'flicker [off]               城市霓虹呼吸 + 隨機停電 (預設開)',
    'term.help.brownout': 'brownout                    立即手動觸發一次區域停電',
    'term.help.thunder': 'thunder                     雷光閃 + 滾雷音 + 雨聲短暫變小',
    'term.help.cinema': 'cinema / vista [off]        電影模式:景深 + 黑邊 + 鏡頭微飄',
    'term.help.tv': 'tv [off]                    馬賽克牆當電視/退出 (3 個本地頻道)',
    'term.help.cast': 'cast [wall|tv] [<YT_ID>]    串流投影 — 預設客廳全息電視,wall=馬賽克牆',
    'term.help.holotint': 'holotint / tint             全息電視色調循環 (無色/淡藍/中藍/深藍/全藍)',
    'term.help.bgm': 'bgm <play|next>             NeuroSound 音樂控制',
    'term.help.art': 'art / gallery               牆上名畫提示 (走到畫框前按 E 換畫)',
    'term.help.lib': 'lib / books                 書架提示',
    'term.help.plan': 'plan / map                  俯視 2D 平面圖 (P 鍵也可切換)',
    'term.help.audit': 'audit / check               物件配置稽核 (埋牆 / 浮空 / 重疊)',
    'term.help.stats': 'stats                       顯示 FPS / 渲染器 / 座標',
    'term.help.devlog': 'devlog                      開啟 DEV.LOG 建造日誌',
    'term.help.viola': 'viola                       開啟 VIOLA.ARCHIVE 家庭錄音',
    'term.help.whoami': 'whoami / ls / cat <檔名>    終端機假裝有檔案',
    'term.help.clear': 'clear                       清螢幕',
    'term.weather.set.prefix': '> 天候控制:雨勢 ',
    'term.weather.get.prefix': '目前雨勢: ',
    'term.weather.get.suffix': ' (用法: weather off|light|heavy)',
    'term.neon.prefix': '> 霓虹色 → ',
    'term.curtain.close': '> 窗簾:下降中…',
    'term.curtain.open': '> 窗簾:上升中…',
    'term.holo.prefix': '> 全息投影 → ',
    'term.lantern.on': '> 馬賽克燈籠 → 點亮 (彩繪玻璃)',
    'term.lantern.off': '> 馬賽克燈籠 → 熄滅',
    'term.desklamp.prefix': '> 桌上土耳其燈 → ',
    'term.mosaic.prefix': '> 翻牌馬賽克牆 → ',
    'term.holotint.prefix': '> 全息投影色調 → ',
    'term.tv.prefix': '> 馬賽克電視 → ',
    'term.pendant.on': '> 吧檯柔光開啟',
    'term.pendant.off': '> 吧檯柔光熄滅',
    'term.dnd.on': '> 勿擾模式 — 門鈴靜音中',
    'term.dnd.off': '> 接受訪客',
    'term.projector.prefix': '> 床頭星空儀 → ',
    'term.plan.on': '> 2D 平面圖開啟 — 走動時三角形跟著動,再 plan 或按 P 關閉',
    'term.plan.off': '> 回到 3D 視角',
    'term.fridge.open': '> 冰箱打開了',
    'term.fridge.close': '> 冰箱關閉',
    'term.lights.prefix': '> 燈光情境 → ',
    'term.books': '> 藏書已實體化 — 到書櫃前看準書脊按 E,把書取下來讀',
    'term.cast.noid': '> 先在 NeuroSound 選一首,或直接 cast wall <YT_ID>',
    'term.cast.wall': '> 解析串流並投影到馬賽克牆…',
    'term.cast.tv': '> 解析串流並投影到客廳…',
    'term.ad.prefix': '> 全息廣告插播 → ',
    'term.flicker.off': '> 霓虹閃爍 → 關閉,城市靜如標本',
    'term.flicker.on': '> 霓虹閃爍 → 開啟,三色慢呼吸 + 隨機停電',
    'term.brownout.prefix': '> ',
    'term.brownout.suffix': ' (約 1 秒)',
    'term.thunder.prefix': '> ',
    'term.cinema.on': '> 電影模式 → 開啟 — 景深 + 黑邊,自動微移鏡頭',
    'term.cinema.off': '> 電影模式 → 關閉',
    'term.art': '> 名畫已上牆 — 看著任何一幅畫框按 E 可換畫',
    'term.iris.prefix': '> 虹:「',
    'term.iris.suffix': '」',
    'term.devlog': '> 解密造屋者日誌…',
    'term.viola': '> 開啟私人錄音檔案庫',
    'term.whoami': 'V (aka 房間的主人)',
    'term.ls': 'manifesto.txt  netrun.cfg  jazz.playlist  no_future/',
    'term.cat.manifesto': '我們在霓虹裡入睡,在雨聲中醒來。\n城市不會記得任何人,但今晚的合成器音色屬於我。',
    'term.cat.notfound.prefix': 'cat: ',
    'term.cat.notfound.suffix': ': 沒有那個檔案',
    'term.hack.suffix': '\n> ACCESS GRANTED ✔ (其實什麼都沒發生)',
    'term.notfound.prefix': "term: 找不到指令 '",
    'term.notfound.suffix': "' — 試試 help",

    // ── CyberOS NeuroSound ──
    'ns.cast': '📽 投影到客廳',
    'ns.search.placeholder': '搜尋 YouTube 音樂… (歌名 / 歌手 / 電台)',
    'ns.search.btn': '🔍 搜尋',
    'ns.hint': '搜尋任何歌曲,點縮圖即播。也可直接貼 YouTube 連結。<br/>音量會隨你離喇叭的距離變化 — 站到窗邊聽聽看。',
    'ns.searching': '⟳ 正在掃描網路節點…(首次搜尋約 5 秒)',
    'ns.noresult': '沒有結果',
    'ns.search.fail.prefix': '⛔ 搜尋失敗:',
    'ns.cast.nosel': '先選一首歌再投影',
    'ns.cast.loading': '⟳ 解析串流中…',

    // ── Netrunner ──
    'browser.placeholder': 'https:// — 部分網站會拒絕嵌入 (X-Frame-Options)',
    'browser.ice': '目標主機拒絕神經連結 (X-Frame-Options)<br/>請換一個節點,或用實體瀏覽器開啟',
    'browser.bm.taipei': '台北地圖',
    'browser.bm.wiby': 'Wiby 復古搜尋',

    // ── SysMon ──
    'sysmon.quality.hint': '切換畫質檔位會重新載入場景',

    // ── Gallery ──
    'gallery.loading': '讀取資料碎片…',
    'gallery.searching': '檢索館藏中…',
    'gallery.fail.prefix': '⛔ 館藏連線失敗:',
    'gallery.decode.fail': '這個碎片解碼失敗,換一個藏家試試',
    'gallery.untitled': '無題',
    'gallery.anon': '佚名',
    'gallery.next': '▶ 下一件藏品',
    'gallery.src': '資料源:大都會博物館 Open Access(公有領域)',
    'gallery.lib.loading': '⟳ 解碼資料碎片…',
    'gallery.lib.more.prefix': '已載入 ',
    'gallery.lib.more.suffix': '% <button class="more">▼ 繼續讀取</button>',
    'gallery.lib.done.prefix': '■ 全書完 (',
    'gallery.lib.done.suffix': 'k 字元)',
    'gallery.lib.fail.prefix': '⛔ 圖書館連線失敗:',
    'gallery.shelf.select': '選擇一本書 — 全文連線自 Project Gutenberg 公共圖書館',
    'gallery.shelf.intro': '紙本在這個年代是奢侈品。<br/>但公共圖書館的資料庫永遠免費。',

    // ── Viola ──
    'viola.header': '♪ 家庭檔案 — 中提琴練習錄音(僅本機,不上雲)',
    'viola.empty.prefix': '資料夾還是空的。<br/>把錄音檔放進 <b style="color:#5af2ff">',
    'viola.empty.suffix': '</b><br/>重新開啟本視窗即自動上架。',
    'viola.fail': '讀取失敗',

    // ── NeoMail ──
    'mail.select': '選一封信件…',
    'mail.from': '寄件者: ',
    'mail.subj': '主旨: ',

    // ── TV channels / holo tints ──
    'tv.ch.crt': 'CRT 軌道追蹤',
    'tv.ch.noise': '雜訊',
    'tv.ch.ad': '廣告',
    'tv.ch.spectrum': '城市頻譜',
    'tv.casting': '點播中',
    'tint.none': '無色',
    'tint.light': '淡藍',
    'tint.mid': '中藍',
    'tint.deep': '深藍',
    'tint.full': '全藍',

    // ── city brownout ──
    'city.mat.cyan': '青藍',
    'city.mat.pink': '霓桃',
    'city.mat.amber': '琥珀',
    'city.brownout.already': ' 區域已熄燈',
    'city.brownout.trigger': ' 區域熄燈',

    // ── star projector ──
    'proj.off': '熄滅',
    'proj.cyber': '賽博全息',
    'proj.cozy': '營火暖光',
    'proj.planet': '古典星象',

    // ── pickable object names ──
    'pick.mug': '咖啡杯',
    'pick.noodle': '泡麵杯',
    'pick.shard': '紫色資料碎片',

    // ── system/RPC fallbacks ──
    'rpc.not.loaded': '(未載入)',
    'rpc.tv.exit.ok': '電視模式關閉,回到藝廊輪播',
    'rpc.tv.exit.noop': '不在電視模式',
    'mosaic.flipping': '(切換中…)',
    'mosaic.no.video': '(無影片)',

    // ── package loot ──
    'package.0': '📦 NEON COLA 兌換箱 — 裡面是 24 罐酸雨檸檬口味',
    'package.1': '📦 鄰居誤送的義體目錄 — 折頁停在「夜視瞳 v2」那頁',
    'package.2': '📦 一束塑膠花,附卡片:「替我澆水 — K」',
    'package.3': '📦 二手書《如何與你的智慧家居和平共處》',
    'package.4': '📦 空箱子。只有一張字條:「他們在看。」',

    // ── weather text ──
    'weather.text': '{city} {temp} 度,{desc}',

    // ── NeoMail messages ──
    'mail.msg.0.from': '房東 K',
    'mail.msg.0.subj': '租金調漲通知',
    'mail.msg.0.body': '住戶你好:\n\n因第七區治安費上調,下季租金調整為 ¥4,200/月。\n附註:上次你陽台的無人機殘骸已清除,費用 ¥350 將併入帳單。\n\n— K',
    'mail.msg.1.from': 'NCPD 自動系統',
    'mail.msg.1.subj': '噪音檢舉結案',
    'mail.msg.1.body': '你於 03:12 檢舉的「樓上機械腳步聲」已結案。\n結案原因:該樓層登記住戶為戰鬥改造退役者,屬合法義體維護行為。\n\n祝你有美好的一天。',
    'mail.msg.2.from': 'Drv.Chen',
    'mail.msg.2.subj': 'Re: 義眼韌體',
    'mail.msg.2.body': '老樣子,韌體我幫你壓到 v0.9.7,夜視模組的色偏修了。\n但你那顆瞳孔的供應商倒了,下次壞掉就真的要換整顆。\n保重。\n\n— 陳',
    'mail.msg.3.from': 'NEON COLA',
    'mail.msg.3.subj': '★ 本週優惠 ★',
    'mail.msg.3.body': '買二送一!全新口味「酸雨檸檬」上市!\n憑此信至任一販賣機輸入代碼 NEON-X 兌換。\n\n(本優惠不適用於現實世界)',

    // ── lang toggle ──
    'lang.toggle': 'EN',
  },

  en: {
    // ── index.html / boot ──
    'lock.desktop': 'Click to enter / CLICK TO JACK IN',
    'lock.keys':
      '<span class="k">WASD</span> Move ·\n        <span class="k">Mouse</span> Look ·\n        <span class="k">Shift</span> Sprint ·\n        <span class="k">E</span> Interact ·\n        <span class="k">ESC</span> Exit',
    'lock.touch': 'Tap anywhere to enter NEON LOFT',
    'lock.touch.keys':
      '<span class="k">Left joystick</span> Move · <span class="k">Swipe</span> Look · <span class="k">Tap</span> Interact',
    'touchhint': 'Swipe to look · Tap to interact · Left joystick to move',

    // ── GPU fail overlay ──
    'gpu.title': 'GPU DRIVER INCOMPATIBLE',
    'gpu.body': 'This browser\'s GPU backend cannot compile shaders (common on Chrome + older Intel iGPU).<br/>Open the page in <b style="color:#5af2ff">Firefox</b> for a smooth experience.',

    // ── interact prompts ──
    'prompt.barLantern.on': 'Put out the lantern',
    'prompt.barLantern.off': 'Light the mosaic lantern',
    'flash.barLantern.on': '🪔 Mosaic lantern lit — stained glass glow',
    'flash.barLantern.off': '🪔 Lantern extinguished',

    'prompt.deskLantern': 'Turkish desk lamp — adjust brightness',
    'prompt.deskLantern.off': 'Brighter',
    'prompt.deskLantern.dim': 'Full brightness',
    'prompt.deskLantern.bright': 'Turn off',
    'flash.deskLantern.off': 'Off',
    'flash.deskLantern.dim': 'Dim (ambient)',
    'flash.deskLantern.bright': 'Bright',
    'flash.deskLantern.prefix': '💡 Desk lamp →',
    'flash.deskLantern.next': 'press again:',

    'prompt.mosaic': 'Flip mosaic — next artwork',
    'flash.mosaic.prefix': '🖼 Mosaic wall →',

    'prompt.monitor': 'Jack into CyberOS',
    'prompt.tv': 'Holographic projection',
    'prompt.tv.screen': 'Change channel',
    'flash.tv.stop': '📽 Projection ended',
    'flash.tv.cast': '📽 Casting: ',
    'flash.tv.resume': '▶ Resume',
    'flash.tv.pause': '⏸ Paused',

    'prompt.neon': 'Cycle neon colour',
    'prompt.record': 'Play vinyl (synth pad)',
    'flash.record.on': '♫ Vinyl spinning…',
    'flash.record.off': 'Vinyl stopped',

    'prompt.window': 'Change rain intensity',
    'flash.rain.prefix': '🌧 Rain: ',

    'prompt.bar': 'Mix a drink',
    'flash.bar': '🍸 NEON COLA + synthetic tequila… cheers!',

    'prompt.sofa': 'Sit down (electric sofa)',
    'flash.sofa.sit': 'Seated — mouse to look · [R] recline · [M] massage · move to stand',
    'flash.stand': 'Standing up',
    'flash.recline.on': '⚙ Reclined — watch the rain above the towers',
    'flash.recline.off': '⚙ Upright',
    'flash.massage.on': '〰 Massage mode — 8 seconds',
    'flash.massage.off': 'Massage off',

    'prompt.bed': 'Take a nap',
    'flash.bed.drunk': '…slept it off',
    'flash.bed.normal': '…napped a while. The rain is still falling.',

    'prompt.lights': 'Lighting mood',
    'flash.lights.prefix': '💡 Lighting: ',

    'prompt.pendants': 'Bar pendant lights',
    'flash.pendants.on': '🪔 Bar lights on — softer against the mosaic wall',
    'flash.pendants.off': '🪔 Bar lights off — high contrast mode',

    'prompt.holo': 'Holographic projector',
    'flash.holo.prefix': '🔮 Holo channel: ',

    'prompt.curtain': 'Electric curtain',
    'flash.curtain.closing': '🪟 Curtain closing…',
    'flash.curtain.opening': '🪟 Curtain opening…',

    'prompt.bookshelf': 'Bookshelf',
    'flash.bookshelf': '📖 Aim at a spine and press E to take it down',
    'prompt.book.prefix': 'Read ',
    'prompt.book.suffix': '',

    'prompt.shardArt': 'Read shard: re-curate all wall art',
    'flash.shardArt': '🖼 Requesting new works from The Met…',
    'prompt.shardAudio': 'Read shard: family recordings',
    'prompt.devlogShard': '??? Golden shard',

    'prompt.frame': 'Swap painting',
    'flash.frame': '🖼 Re-curating…',

    'prompt.bathDoor': 'Bathroom door',
    'flash.bathDoor.open': '🚪 Door open',
    'flash.bathDoor.close': '🚪 Door closed',
    'prompt.toilet': 'Flush',
    'flash.toilet': '🚽 Whoosh—',
    'prompt.mirror': 'Smart mirror',
    'flash.mirror': '🪞 Facial scan: rating SSS — very cyberpunk tonight',
    'prompt.shower': 'Shower',
    'flash.shower.on': '🚿 Hot water + steam…',
    'flash.shower.off': '🚿 Off',
    'prompt.washer': 'Laundry',
    'flash.washer': '🌀 20-second wash cycle — drum spinning',

    'prompt.speaker': 'Music play/pause',
    'flash.speaker.load': '🎧 No station loaded — opening NeuroSound',
    'flash.speaker.pause': '⏸ Music paused',
    'flash.speaker.play': '▶ Music playing — pairs perfectly with the rain',

    'prompt.iris': 'Call 虹 // IRIS',
    'flash.iris.prefix': '🟣 IRIS: "',
    'flash.iris.suffix': '"',

    'prompt.cat': 'Pet the cat',
    'flash.cat': '🐈‍⬛ Nightcat: purrrr… (tail swish)',
    'prompt.coffee': 'Brew coffee',
    'flash.coffee.brewing': '☕ Grinding synthetic beans… (7 s)',
    'flash.coffee.busy': '☕ Already brewing — hold on',

    'prompt.door': 'Front door',
    'flash.door.open': '🚪 Lock released — door open',
    'flash.door.close': '🚪 Door closed, locked',
    'prompt.package': 'Pick up package',

    'prompt.wardrobe': 'Change outfit',
    'flash.wardrobe.prefix': '🧥 Cyberware skin →',
    'flash.wardrobe.suffix': '(check yourself in the mirror)',

    'prompt.projector': 'Bedside star projector',
    'flash.projector.prefix': '✨ Star projector →',

    'prompt.pickup.prefix': 'Pick up ',
    'flash.pickup.held': '✋ Holding "',
    'flash.pickup.held.suffix': '" — [F] Drop · [Q] Return',
    'flash.pickup.drop': '📍 "',
    'flash.pickup.drop.suffix': '" dropped here',
    'flash.pickup.return': '↩ "',
    'flash.pickup.return.suffix': '" returned',

    'prompt.fridge': 'Open fridge',
    'flash.fridge.open': "🧊 NEON COLA × 5 + mystery purple bottle + neighbour's plastic flower",
    'flash.fridge.close': '🚪 Fridge closed',

    'prompt.dnd': 'Do-Not-Disturb toggle',
    'flash.dnd.on': '🔇 DND on — doorbell silenced, packages still pile up',
    'flash.dnd.off': '🔔 Accepting visitors — queued packages released on next ring',

    'flash.doorbell': '🔔 Doorbell — someone left something at the door',
    'flash.doorbell.missed': '🔔 Doorbell — a delivery arrived while you were away',

    'prompt.arcade.screen': 'Insert coin — NEON BREAKER',
    'prompt.arcade.shell': 'Insert coin — NEON BREAKER',
    'flash.arcade.leave': 'Left the arcade — come back for the high score',

    'flash.cyberos.vr': '⏏ CyberOS unavailable in VR (DOM overlay)',

    // ── floor plan ──
    'plan.title': 'FLOOR PLAN ▸ NEON LOFT',
    'plan.info.prefix': 'Room ',
    'plan.info.mid': 'm × ',
    'plan.info.suffix': 'm  ·  ',
    'plan.info.end': ' objects  ·  P or "plan" to exit',
    'plan.legend.wall': 'Wall/structure',
    'plan.legend.furniture': 'Furniture',
    'plan.legend.interactive': 'Interactive',
    'plan.legend.pickable': 'Pickable',
    'plan.legend.prop': 'Prop',

    // ── bookreader ──
    'book.loading': 'Fetching pages…',
    'book.error': '⛔ Library connection failed',
    'book.footer.read': '— End of book —',
    'book.footer.nav': '%  ·  [A/D] Turn page  [E] Close',

    // ── audit report ──
    'audit.pass': '> Placement audit ✓ All clear (no embedded walls / floating / major overlap)',
    'audit.head.prefix': '> Placement audit — found ',
    'audit.head.suffix': ' issue(s):',
    'audit.more.prefix': '  …and ',
    'audit.more.suffix': ' more. Full list in browser console: window.neon.audit()',

    // ── cast pipeline ──
    'flash.cast.wall.fail': '⛔ Mosaic wall not loaded yet',
    'flash.cast.wall': '📡 Casting to mosaic wall — 28×5 LED panel',
    'flash.cast.wall.done': '📡 Cast to mosaic wall — head to the kitchen to watch',
    'flash.cast.tv': '📽 Projection up — go back to the living room, the film floats mid-air',
    'flash.cast.tv.done': '📽 Cast to living room — press ESC to walk around while watching',
    'flash.cast.fail.prefix': '⛔ Cast failed: ',

    // ── thunder ──
    'flash.thunder': '⚡ Lightning + thunder — rain briefly quiets',

    // ── IRIS lines ──
    'iris.0': 'The rain in Night City is more punctual than your deadlines.',
    'iris.1.a': 'Outside in the real world: ',
    'iris.1.b': '. The rain out that window, though — that one\'s ours.',
    'iris.1.no': 'Location data hasn\'t come back yet. Feels like it\'s raining everywhere.',
    'iris.2': 'Your caffeine intake is above threshold. Should I look the other way, or brew another?',
    'iris.3': 'Nightcat changed sleeping spots three times today. Busier schedule than yours.',
    'iris.4': 'Note: you\'ve been staring at the city for a while. That\'s not a bad thing — just logging it.',
    'iris.5': 'Too much rain? Let me dial it down a notch. …Done.',
    'iris.time.prefix': 'Current time: ',
    'iris.time.h': ':',
    'iris.time.m': '. ',

    // ── lighting moods ──
    'mood.standard': '標準',
    'mood.reading': '閱讀',
    'mood.cinema': '影院',
    'mood.party': '派對',
    'mood.dark': '全暗',

    // ── WMO weather descriptions ──
    'wmo.clear': 'Clear',
    'wmo.partly': 'Partly cloudy',
    'wmo.overcast': 'Overcast',
    'wmo.fog': 'Fog',
    'wmo.drizzle': 'Drizzle',
    'wmo.rain': 'Rain',
    'wmo.snow': 'Snow',
    'wmo.showers': 'Showers',
    'wmo.thunderstorm': 'Thunderstorm',

    // ── CyberOS Terminal ──
    'term.boot': 'CyberOS NeoTerm — type help for commands',
    'term.help.env': '── Environment / Ambience ──',
    'term.help.lights': '── Lighting ──',
    'term.help.visual': '── Visual devices ──',
    'term.help.atmo': '── Atmosphere / Cinematic ──',
    'term.help.av': '── A/V Projection ──',
    'term.help.gallery': '── Gallery / Library ──',
    'term.help.sys': '── System / Easter eggs ──',
    'term.help.weather': 'weather <off|light|heavy>   control rain outside',
    'term.help.curtain': 'curtain                     raise/lower electric curtain',
    'term.help.neon': 'neon                        cycle window neon colour',
    'term.help.light': 'light                       lighting mood (standard/reading/cinema/party/dark)',
    'term.help.dnd': 'dnd / quiet                 do-not-disturb — silences doorbell',
    'term.help.lantern': 'lantern                     bar mosaic lantern on/off',
    'term.help.desklamp': 'desklamp                    desk Turkish lamp 3-way: off/dim/bright',
    'term.help.wash': 'wash / pendant              bar pendant lights on/off',
    'term.help.mosaic': 'mosaic                      flip mosaic wall — next artwork (14 works)',
    'term.help.holo': 'holo                        coffee table holo projector (sphere/city/gem)',
    'term.help.ad': 'ad                          broadcast a holo ad on the skyline',
    'term.help.iris': 'iris                        IRIS holographic assistant — say a line',
    'term.help.flicker': 'flicker [off]               city neon breathing + random blackouts (default on)',
    'term.help.brownout': 'brownout                    trigger a manual district blackout',
    'term.help.thunder': 'thunder                     lightning flash + thunder + rain dip',
    'term.help.cinema': 'cinema / vista [off]        cinema mode: DOF + letterbox + subtle pan',
    'term.help.tv': 'tv [off]                    mosaic wall as TV / exit (3 local channels)',
    'term.help.cast': 'cast [wall|tv] [<YT_ID>]    stream cast — default holo TV; wall=mosaic',
    'term.help.holotint': 'holotint / tint             holo TV tint cycle (none/light/mid/deep/full blue)',
    'term.help.bgm': 'bgm <play|next>             NeuroSound music control',
    'term.help.art': 'art / gallery               wall art hint (face a frame and press E to swap)',
    'term.help.lib': 'lib / books                 bookshelf hint',
    'term.help.plan': 'plan / map                  top-down 2D floor plan (P key also works)',
    'term.help.audit': 'audit / check               placement audit (walls / floating / overlap)',
    'term.help.stats': 'stats                       show FPS / renderer / position',
    'term.help.devlog': 'devlog                      open DEV.LOG build journal',
    'term.help.viola': 'viola                       open VIOLA.ARCHIVE family recordings',
    'term.help.whoami': 'whoami / ls / cat <file>    terminal pretends there are files',
    'term.help.clear': 'clear                       clear the screen',
    'term.weather.set.prefix': '> Weather control: rain ',
    'term.weather.get.prefix': 'Current rain: ',
    'term.weather.get.suffix': ' (usage: weather off|light|heavy)',
    'term.neon.prefix': '> Neon colour → ',
    'term.curtain.close': '> Curtain: closing…',
    'term.curtain.open': '> Curtain: opening…',
    'term.holo.prefix': '> Holo projector → ',
    'term.lantern.on': '> Mosaic lantern → lit (stained glass)',
    'term.lantern.off': '> Mosaic lantern → off',
    'term.desklamp.prefix': '> Desk Turkish lamp → ',
    'term.mosaic.prefix': '> Mosaic wall → ',
    'term.holotint.prefix': '> Holo tint → ',
    'term.tv.prefix': '> Mosaic TV → ',
    'term.pendant.on': '> Bar pendant lights on',
    'term.pendant.off': '> Bar pendant lights off',
    'term.dnd.on': '> DND on — doorbell silenced',
    'term.dnd.off': '> Accepting visitors',
    'term.projector.prefix': '> Star projector → ',
    'term.plan.on': '> 2D floor plan on — triangle follows you, type plan or press P to exit',
    'term.plan.off': '> Back to 3D',
    'term.fridge.open': '> Fridge open',
    'term.fridge.close': '> Fridge closed',
    'term.lights.prefix': '> Lighting mood → ',
    'term.books': '> Books materialised — aim at a spine near the shelf and press E',
    'term.cast.noid': '> Load a track in NeuroSound first, or: cast wall <YT_ID>',
    'term.cast.wall': '> Resolving stream, casting to mosaic wall…',
    'term.cast.tv': '> Resolving stream, casting to living room…',
    'term.ad.prefix': '> Holo ad broadcast → ',
    'term.flicker.off': '> Neon flicker → off, city still as a specimen',
    'term.flicker.on': '> Neon flicker → on, three-colour slow pulse + random blackouts',
    'term.brownout.prefix': '> ',
    'term.brownout.suffix': ' (~1 s)',
    'term.thunder.prefix': '> ',
    'term.cinema.on': '> Cinema mode → on — DOF + letterbox, subtle cam drift',
    'term.cinema.off': '> Cinema mode → off',
    'term.art': '> Art is on the walls — face any frame and press E to swap',
    'term.iris.prefix': '> IRIS: "',
    'term.iris.suffix': '"',
    'term.devlog': '> Decrypting builder\'s journal…',
    'term.viola': '> Opening private recording archive',
    'term.whoami': 'V (the room\'s owner)',
    'term.ls': 'manifesto.txt  netrun.cfg  jazz.playlist  no_future/',
    'term.cat.manifesto': 'We fall asleep in neon, and wake to the sound of rain.\nThe city remembers no one, but tonight\'s synth pad belongs to me.',
    'term.cat.notfound.prefix': 'cat: ',
    'term.cat.notfound.suffix': ': no such file',
    'term.hack.suffix': '\n> ACCESS GRANTED ✔ (nothing actually happened)',
    'term.notfound.prefix': "term: command not found '",
    'term.notfound.suffix': "' — try help",

    // ── CyberOS NeuroSound ──
    'ns.cast': '📽 Cast to living room',
    'ns.search.placeholder': 'Search YouTube music… (song / artist / station)',
    'ns.search.btn': '🔍 Search',
    'ns.hint': 'Search any track, click thumbnail to play. Or paste a YouTube link.<br/>Volume follows your distance from the speakers — try standing by the window.',
    'ns.searching': '⟳ Scanning network nodes… (first search ~5 s)',
    'ns.noresult': 'No results',
    'ns.search.fail.prefix': '⛔ Search failed: ',
    'ns.cast.nosel': 'Select a track first before casting',
    'ns.cast.loading': '⟳ Resolving stream…',

    // ── Netrunner ──
    'browser.placeholder': 'https:// — some sites block embedding (X-Frame-Options)',
    'browser.ice': 'Target host refused neural connection (X-Frame-Options)<br/>Try a different node, or open in a real browser',
    'browser.bm.taipei': 'Taipei Map',
    'browser.bm.wiby': 'Wiby Retro Search',

    // ── SysMon ──
    'sysmon.quality.hint': 'Switching quality preset reloads the scene',

    // ── Gallery ──
    'gallery.loading': 'Reading data shards…',
    'gallery.searching': 'Searching collection…',
    'gallery.fail.prefix': '⛔ Collection connection failed: ',
    'gallery.decode.fail': 'This shard failed to decode — try another collector',
    'gallery.untitled': 'Untitled',
    'gallery.anon': 'Unknown artist',
    'gallery.next': '▶ Next artwork',
    'gallery.src': 'Source: The Metropolitan Museum of Art Open Access (public domain)',
    'gallery.lib.loading': '⟳ Decoding data shard…',
    'gallery.lib.more.prefix': 'Loaded ',
    'gallery.lib.more.suffix': '% <button class="more">▼ Load more</button>',
    'gallery.lib.done.prefix': '■ End of book (',
    'gallery.lib.done.suffix': 'k chars)',
    'gallery.lib.fail.prefix': '⛔ Library connection failed: ',
    'gallery.shelf.select': 'Select a book — full text via Project Gutenberg public library',
    'gallery.shelf.intro': 'Physical books are a luxury in this era.<br/>But the public library\'s database is always free.',

    // ── Viola ──
    'viola.header': '♪ Family archive — viola practice recordings (local only, not synced)',
    'viola.empty.prefix': 'Folder is empty.<br/>Drop audio files into <b style="color:#5af2ff">',
    'viola.empty.suffix': '</b><br/>Reopen this window to list them.',
    'viola.fail': 'Load failed',

    // ── NeoMail ──
    'mail.select': 'Select a message…',
    'mail.from': 'From: ',
    'mail.subj': 'Subject: ',

    // ── NeoMail messages ──
    'mail.msg.0.from': 'Landlord K',
    'mail.msg.0.subj': 'Rent Increase Notice',
    'mail.msg.0.body': "Tenant,\n\nDue to increased security fees in District 7, next quarter's rent is adjusted to ¥4,200/mo.\nNote: drone wreckage from your balcony has been removed; ¥350 will be added to your bill.\n\n— K",
    'mail.msg.1.from': 'NCPD AutoSys',
    'mail.msg.1.subj': 'Noise Complaint — Closed',
    'mail.msg.1.body': 'Your complaint filed at 03:12 regarding "mechanical footsteps from above" has been closed.\nReason: registered occupant of that floor is a combat-aug veteran — legal cyberware maintenance.\n\nHave a nice day.',
    'mail.msg.2.from': 'Drv.Chen',
    'mail.msg.2.subj': 'Re: Eye firmware',
    'mail.msg.2.body': "Usual deal — compressed it to v0.9.7, fixed the night-vision colour shift.\nBut your iris supplier went under. If it breaks again, you're replacing the whole unit.\nTake care.\n\n— Chen",
    'mail.msg.3.from': 'NEON COLA',
    'mail.msg.3.subj': "★ This Week's Deal ★",
    'mail.msg.3.body': 'Buy 2 get 1 free! New flavour "Acid Rain Lemon" is here!\nShow this message at any vending machine and enter code NEON-X.\n\n(Offer not valid in the real world)',

    // ── TV channels / holo tints ──
    'tv.ch.crt': 'CRT Orbit Track',
    'tv.ch.noise': 'Static',
    'tv.ch.ad': 'Ads',
    'tv.ch.spectrum': 'City Spectrum',
    'tv.casting': 'Casting',
    'tint.none': 'None',
    'tint.light': 'Light blue',
    'tint.mid': 'Mid blue',
    'tint.deep': 'Deep blue',
    'tint.full': 'Full blue',

    // ── city brownout ──
    'city.mat.cyan': 'Cyan-Blue',
    'city.mat.pink': 'Neon Pink',
    'city.mat.amber': 'Amber',
    'city.brownout.already': ' district already dark',
    'city.brownout.trigger': ' district lights out',

    // ── star projector ──
    'proj.off': 'Off',
    'proj.cyber': 'Cyber holo',
    'proj.cozy': 'Warm campfire',
    'proj.planet': 'Classic planetarium',

    // ── pickable object names ──
    'pick.mug': 'coffee mug',
    'pick.noodle': 'instant noodle cup',
    'pick.shard': 'purple data shard',

    // ── system/RPC fallbacks ──
    'rpc.not.loaded': '(not loaded)',
    'rpc.tv.exit.ok': 'TV mode off — back to gallery loop',
    'rpc.tv.exit.noop': 'Not in TV mode',
    'mosaic.flipping': '(switching…)',
    'mosaic.no.video': '(no video)',

    // ── package loot ──
    'package.0': '📦 NEON COLA redemption box — 24 cans, acid-rain lemon flavour',
    'package.1': '📦 Cyberware catalogue misdelivered by neighbour — bookmarked at "Nightvision Iris v2"',
    'package.2': '📦 A plastic flower bouquet, with a note: "Water me — K"',
    'package.3': '📦 Second-hand: How to Coexist With Your Smart Home',
    'package.4': '📦 Empty box. Just a note inside: "They\'re watching."',

    // ── weather text ──
    'weather.text': '{city} {temp} °C, {desc}',

    // ── lang toggle ──
    'lang.toggle': '中',
  },
};

// ─── State ───────────────────────────────────────────────────────────────────
function detectLang(): Lang {
  // 1. URL ?lang=
  const urlParam = new URLSearchParams(location.search).get('lang');
  if (urlParam === 'en' || urlParam === 'zh') return urlParam;
  // 2. localStorage
  const stored = localStorage.getItem('neon-lang');
  if (stored === 'en' || stored === 'zh') return stored as Lang;
  // 3. navigator.language
  if (navigator.language.startsWith('zh')) return 'zh';
  // 4. default
  return 'en';
}

let currentLang: Lang = detectLang();

/** Translate key. Returns the key itself if not found (visible fallback). */
export function t(key: string): string {
  return dict[currentLang][key] ?? dict['zh'][key] ?? key;
}

/** Switch language, persist to localStorage, and dispatch a custom event. */
export function setLang(lang: Lang): void {
  currentLang = lang;
  localStorage.setItem('neon-lang', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  window.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}

export function getLang(): Lang {
  return currentLang;
}

/** Mount the language toggle button in the HUD and wire the click handler.
 *  Called once from main.ts after the DOM is ready. */
export function mountLangToggle(): void {
  const btn = document.createElement('button');
  btn.id = 'lang-toggle';
  btn.textContent = t('lang.toggle');
  btn.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:30;'
    + 'font-family:"Share Tech Mono",monospace;font-size:12px;'
    + 'color:#5af2ff;background:rgba(0,0,0,0.55);'
    + 'border:1px solid #5af2ff66;padding:4px 9px;cursor:pointer;'
    + 'letter-spacing:.08em;pointer-events:auto;'
    + 'transition:background .2s;';
  btn.onmouseenter = () => { btn.style.background = 'rgba(90,242,255,0.18)'; };
  btn.onmouseleave = () => { btn.style.background = 'rgba(0,0,0,0.55)'; };
  btn.onclick = () => {
    const next: Lang = currentLang === 'zh' ? 'en' : 'zh';
    setLang(next);
    btn.textContent = t('lang.toggle');
    // Reload to re-render all static strings. Instant switch for elements
    // that read `t()` reactively (toast/prompt) will happen automatically
    // via the langchange event; static HTML strings need a reload.
    location.reload();
  };
  document.body.appendChild(btn);
}
