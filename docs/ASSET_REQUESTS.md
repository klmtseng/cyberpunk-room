# AI 生成素材需求規格

## ⭐ 優先序更新（2026-06-12,對照 IMG_5703/5701 俯瞰風格分析後）

差距核心:參考圖的每面牆都掛滿發光廣告板、路口被霓虹打成白晝、整體紫色統調。
最高優先的素材是 **廣告看板圖集**:

### 0. 看板圖集 Billboard Atlas（新·最優先）

| 項目 | 規格 |
|---|---|
| 檔名 | `billboard_atlas.png` |
| 尺寸 | **2048×2048**,切成 **4×4 = 16 格**(每格 512×512) |
| 內容 | 16 張互不相同的賽博朋克發光廣告:日式/中式霓虹店招、飲料、拉麵、科技公司 logo、美妝、酒吧——**每格邊緣留 16px 深色邊**,深色底發光字 |
| 用法 | 我會切成 instanced 貼片,每棟樓面隨機貼 2–6 塊(共 300+ 塊),這就是參考圖「滿牆廣告」的密度來源 |

**建議提示詞**:
> sprite sheet of 16 different glowing cyberpunk advertisement billboards arranged in a perfect 4x4 grid, each cell 512x512 with dark border, neon japanese and chinese shop signs, ramen, cola, tech logos, cosmetics, bar signs, vibrant magenta cyan yellow on dark background, flat front view, game texture atlas

### 0b. 路口俯瞰貼圖（新·次優先)

| 項目 | 規格 |
|---|---|
| 檔名 | `street_intersection.png` |
| 尺寸 | 2048×2048,**正俯視** |
| 內容 | 賽博朋克路口正上方俯瞰:斑馬線、車流光軌、霓虹反光濕地面、紫白色光污染,四邊能大致銜接(我會平鋪) |

**建議提示詞**:
> top-down aerial view of a cyberpunk city intersection at night, crosswalk markings, glowing traffic light trails, wet asphalt reflecting purple and white neon, light pollution flooding the streets, seamless tileable game texture, straight orthographic view from directly above

把生成好的圖放進 `public/assets/textures/backdrop/`（檔名照下表），重新整理頁面即生效。
PNG 或 JPG 皆可（PNG 優先）。風格基準:已上傳的三張參考圖（Neo-Kyoto 空拍 / Techno-Ramen 街景）。

## 1. 主遠景全景（最重要）

| 項目 | 規格 |
|---|---|
| 檔名 | `backdrop_aerial.png`（直接覆蓋現有檔案） |
| 尺寸 | **4096×1024**（或至少 3072×768),寬幅橫向 |
| 視角 | 高空俯瞰(約 45 層樓高度往外看),地平線位於畫面上方 1/4 處 |
| 內容 | 連綿到地平線的賽博朋克巨型都市,無明顯主體建築(避免單棟搶鏡),左右兩端亮度盡量接近(會做環形包覆) |

**建議提示詞**:
> ultra-wide aerial panorama of an endless cyberpunk megacity at night, seen from a high-rise window, dense futuristic skyscrapers receding to the horizon, neon signs in magenta cyan purple, rain haze, glowing street grid far below, no single dominant landmark, even lighting across the frame, cinematic, ultra detailed — AR 4:1

## 2. 左右側翼街景 ×2

| 項目 | 規格 |
|---|---|
| 檔名 | `backdrop_street_a.png` / `backdrop_street_b.png`（覆蓋現有） |
| 尺寸 | **2048×1152** |
| 視角 | 半空俯角街景,巨構建築 + 霓虹招牌(現有兩張的高解析版即可) |

## 3. 全息廣告素材（選配,加分項）

| 項目 | 規格 |
|---|---|
| 檔名 | `holo_figure.png` |
| 尺寸 | 1024×1536(直幅) |
| 內容 | **黑色背景**上的發光人物剪影/藝妓面孔/金魚等全息投影主體,單色調(青或洋紅),邊緣自然發光。黑底會被 shader 變成透明 |

**建議提示詞**:
> glowing holographic geisha face projection, single cyan color on pure black background, scanline aesthetic, translucent edges, cyberpunk hologram advertisement style

## 4. 垂直霓虹招牌貼圖（選配)

| 項目 | 規格 |
|---|---|
| 檔名 | `sign_vertical_01.png` ~ `sign_vertical_04.png` |
| 尺寸 | 512×2048(直幅長條) |
| 內容 | 日式/中式直書霓虹招牌(拉麵、酒場、電器行…),深色底 |

---

備註:
- 上述檔案放入後我會在下個回合接管整合與色調匹配
- 已停用上海外灘 HDRI(`public/assets/hdri/shanghai_bund_2k.hdr` 留檔未使用,可刪)
- 免費生成 API(pollinations)已改收費,故採「使用者生成 → 專案整合」流程
