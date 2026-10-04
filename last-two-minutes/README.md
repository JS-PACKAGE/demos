# 一顆星球最後的兩分鐘

以 **XYZ.js 1.13.0** 即時渲染的 120 秒瀏覽器演出，不是預錄影片。星球、城市燈光、艦隊、地殼碎塊、GPU 粒子與原創 OPM／PCM 聲音全部由程式產生；無遠端美術、音樂、帳號或分析服務。

**目前為審閱階段，不是完成全片。** 主入口保留舊視覺時間軸原型；新星球、主力艦與厚曲面地殼先提供三段預覽，待小語確認後才整合完整 120 秒演出。尚未完成最終 Gate C，也尚未發布。

## 本機

需要 Node.js ≥22.13.0、pnpm **12.6.0**。若本機沒有 pnpm，可把以下 `pnpm` 替換為 `npx --yes pnpm@12.6.0`。

```sh
cd last-two-minutes
node scripts/verify-engine.mjs
pnpm install --frozen-lockfile
pnpm dev
```

開發伺服器依小語最新更正綁 `127.0.0.1`，保留 `allowedHosts: true`，接受任何 Host；本機開 `http://127.0.0.1:5173/`。不直接對其他網路介面監聽。允許所有 Host 會取消 hostname／DNS-rebinding 防護，僅在可信環境使用，不是正式部署。禁止 `file://`；WebGPU／音訊仍受瀏覽器安全來源限制，非 loopback 網域請用 HTTPS。需要 **WebGPU 或支援 3D／instancing 的 WebGL2**；Canvas2D 只顯示不支援，不會以 2D 替代。缺少浮點色彩附件時關閉 HDR/bloom／加權透明。

按「開始演出」以使用者手勢解鎖官方八槽音訊；解鎖與解碼完成前不推進時間。也可明示「無聲播放」。演出中只提供暫停、繼續、重播；重播在同頁重置時間、種子、粒子與音訊，不重新載入。隱藏分頁時時間與聲音停止、不追幀。演完 120 模擬秒後停住、不循環。含閃光效果。

## 先審閱四段美術

- [艦船掠過星球](http://127.0.0.1:5173/visual-preview.html#flyby)
- [命中後板塊錯位、斷面與深層裂口](http://127.0.0.1:5173/visual-preview.html#wounded)
- [厚曲面地殼崩解與降亮](http://127.0.0.1:5173/visual-preview.html#aftermath)
- [戰艦交火、受創燃燒與擊毀](http://127.0.0.1:5173/visual-preview.html#combat)

此入口僅供 Vite 開發模式審閱，不放入正式建置。每段 12 模擬秒，固定 seed；可切換、暫停、恢復、同頁重播。按「播放配樂」會先解鎖官方音訊，再從本段起點重播並播放對應時點的 FM score。全畫面維持 16:9 letterbox、不裁切、不捲動；控制會自動淡出，滑鼠、觸控或鍵盤可喚回。

新模型使用連續位移地形與 PBR 貼圖、分層金屬艦體、不規則厚曲面殼與破裂內側。144 段裂縫以 12 批 vertex-alpha mask 漸進顯露，而非 144 次獨立繪製。崩解後鏡頭拉遠、碎塊餘熱消退，最後不保留完整星球。GPU 粒子在重播時重新建立並 prepare：官方 `clear()` 不重置完整 native 時鐘與隨機序列。

## 完整時間軸（舊視覺原型，待整合）

| 模擬秒 | 演出 |
|---|---|
| 0–20 | 星球弧面、薄大氣與城市燈光，拉開後遠方炮火與艦隊 |
| 20–50 | 追隨戰機穿越交火；星球留在畫面內 |
| 50–70 | 硬切地表仰望，天空炮火與巨艦遮光 |
| 70–95 | 主武器、防守艦隊、安靜星球交替硬切 |
| 95–110 | 命中、灼點、裂縫、內光；完整輪廓與近乎無聲的停頓 |
| 110–120 | 地殼外翻、核心、衝擊波，最後降亮停在塵雲、碎片與一道光 |

## 原創 OPM 配樂

八種原創四運算子 FM 音色：弦樂、號角、低音、短弓 ostinato、定音鼓、軍鼓、豎琴、警報。468 個編排音符包含八音主題、開場和聲、120-BPM 戰鬥節奏、地表回應、倒數加速與命中後留白；不是採樣交響樂，也不是另一套 synth。

使用官方八槽 OPM、每音符音色力度與空間定位，加入原創 impulse 的原生 convolution reverb、高通與各 context 的 compressor；不宣稱跨八個 context 的全域 limiter。四段原創 seeded PCM 音效仍由程式產生。力度在官方 voice validation **之前**編寫，保留驗證回傳的 voice 本體，避免複製正規化 voice 後失去 adapter 的版本識別而無法播放。

## 檢查與展出建置

```sh
pnpm test
pnpm typecheck
GAME_BASE=/last-two-minutes/ pnpm build
GAME_BASE=/last-two-minutes/ pnpm preview
```

`node:test` 驗證不依賴 GPU 的時鐘／導演契約，以及計入 release tail 的八槽上限與安靜段落邊界。Vite 沿用引擎 3D starter；`dist/` 包含完整未修改引擎樹與其授權。正式 HTML 內含 strict CSP meta，沒有 `unsafe-eval`、inline script/style、遠端 script。Pages 不套用 `_headers`；meta 不支援 `frame-ancestors`，這項只在能提供真實標頭的主機生效。

唯一執行期依賴為 `file:vendor/xyz.js.tgz`。釘選 GitHub Release [`v1.13`](https://github.com/JS-PACKAGE/XYZ.js/releases/tag/v1.13) 的 `xyz.js-1.13.0.tgz`，不追 main、不從 npm 安裝引擎。安裝／複製／建置先驗 tarball 與原始 `SHA256SUMS`：

```text
353d97d6e8fe16346fc75db04e1263bcd774fef370425d6fe1c9fe80136db915
```

## Pages 發布（尚未執行）

展出目標：**https://demos.js-package.xyz/last-two-minutes**。本機預覽不是上線。不要把開發 `index.html` 原樣部署，也不要把網址改成 `/dist/`。

倉庫提供手動 `.github/workflows/last-two-minutes-pages.yml`，沒有 push 自動發布：

1. 經小語批准後 commit/push 本次變更；本次實作不代做。
2. 在 GitHub Settings → Pages 將來源由 branch 切成 **GitHub Actions**，自訂網域維持 `demos.js-package.xyz`；這是外部設定，需核准。
3. 在 Actions 手動執行「展出一顆星球最後的兩分鐘」。工作流程複核雜湊、安裝鎖檔、測契約、以 `/last-two-minutes/` 建置，組成 `.pages/last-two-minutes/` artifact 後發布。
4. 依 `PLAN.md` Gate E 核對兩種尾斜線網址、`engine/src/index.js`、瀏覽器實際 CSP 與乾淨 clone 建置。根路徑 404 不算失敗。

本機可在正式建置後執行 `node scripts/pages-artifact.mjs` 預先組 artifact。輸出目錄 `.pages/` 必須不存在，以拒絕混入舊展出檔；它被 Git 忽略。artifact 只帶建置產物、原樣 `CNAME` 與 `.nojekyll`，不覆蓋 `src/`，也不改倉庫根 `CNAME`／`LICENSE`。

## 架構與授權

- `src/show/contract.ts`：時間、鏡頭、事件、亮度、增益、種子與設計預算的唯一真值。
- `src/show/clock.ts`／`director.ts`：只吃場景模擬 delta 的時鐘與純函數取樣。
- `src/scene/`／`src/audio/`：唯一匯入 `xyz.js` 的介接層；其他程式不接觸引擎。
- `src/main.ts`：繁體中文觀眾控制，無互動鏡頭、任意時間拖曳或持久化。
- `src/scene/planet-model.ts`／`ship-model.ts`／`visual-preview.ts`：待審閱的新美術與真實 GPU 預覽。
- `src/audio/score.ts`／`synthesis.ts`／`show-audio.ts`：原創編曲、FM 音色與官方音訊生命週期。
- `src/ui/visual-preview.ts`：預覽切換、試聽、暫停與量測顯示，不直接匯入引擎。
- `PLAN.md`：桌面企劃書全文；`AGENTS.md`：實作與全部安全規則；`CLAUDE.md`：只引用同一份規則。

本目錄隨倉庫採 **AGPL-3.0**（見根 [`LICENSE`](../LICENSE)）；內嵌 XYZ.js 仍為 **Apache-2.0**。引擎／官方 OPM vendor 位元組與各自授權原樣保存，不得宣稱整包改為 Apache-2.0。

## 本次實際驗證

- `pnpm test`：10 個行為測試通過；展出前綴建置與型別檢查通過。
- 主入口實際播放至 26 模擬秒，官方八個 48-kHz AudioContext 均產生非零 DSP 輸出；暫停 4 秒時所有 context suspended、音訊時鐘與演出時間不變；恢復與同頁重播成功。測試 probe 在目的端前量測並靜音硬體，完成後移除，並未改動作品音量。
- 正式 `/last-two-minutes/` 建置也在實際 CSP 下驗證原生 FM 輸出；暫停 5 秒時演出時間與八個 context 的音訊時鐘完全不變，恢復與同頁重播成功，無瀏覽器或引擎錯誤。此項不是完整 120 秒驗收。
- 三段預覽均已實際渲染；配樂按鈕、暫停、恢復、重播與崩解 12 秒終點停止音訊已驗證。結尾截圖已確認完整星球消失、餘熱降亮。
- 主入口及預覽均在 1280×720、390×844、844×390 實際檢查：scroll dimensions 等於 viewport，16:9 畫面完整，必要按鈕位於視窗內。這是桌面瀏覽器 emulation，不是實體手機驗收。
- loopback 實際監聽 `127.0.0.1:5173`；任意 Host header 請求回應 HTTP 200。
- 最新預覽深化方向性山脈、連續地貌與雲層、凹入維修艙、雙層裝甲，以及不等尺寸厚曲面岩層與分岔裂口；三段已實際渲染。震波透明度隨時間下降。
- 三個噴嘴加入持續原生 GPU 粒子流：每個 capacity 256、180/s、壽命 0.8 秒，中央暖色、兩側藍色；保留已發射粒子的 world-space 軌跡並縮小淡出。僅在掠過預覽建立，尚未整合全片。
- 最新尾流預覽暫停 1.5 秒時時間固定在 6.0164 秒；恢復後到 12 秒停住，等待 1 秒仍為 12 秒；同頁重播回到 0.0166 秒並重新播放。三段無頁面／引擎錯誤。
- 地表保留 20 個 seeded 球面板塊與交界隆起，降低整片高原的膨脹感；海岸增加細尺度分岔，植被依緯度、降雨與山地過渡，海水降低 roughness，雪線避免大片低地泛白。256×128 地表仍有 33,153 頂點、65,024 三角形；高度適量強化，不宣稱精確地球比例或照片級擬真。
- 最新 geometry smoke：頂點皆有限，半徑 9.9999995–10.4500002，法線長度 0.99999995–1.00000005，經線接縫位置與法線誤差 0。地表明確使用 OPAQUE，修正預設 BLEND 與透明殼排序造成的遮雲／背面透出；三段同頁重播至約 6 秒的乾淨執行無頁面／引擎錯誤。本輪建置、型別檢查與既有 10 個測試通過。
- 雲層改用 PBR BLEND 薄殼與 2048×1024 連續光學厚度貼圖，加入破碎雲帶與小尺度細節；貼圖約 58.8% 像素 alpha <10、12.0% >128，保留露出陸海的空隙。NativeMaterial3D 大氣隨視角增厚、在最外緣淡出，RGB 正確 premultiply 後交給日照著色，不再是硬亮藍線。
- 命中預覽已移除細條裂縫覆蓋：沿連續扭曲球面分區切開原地表三角面，保留球殼曲率與原地貌。破壞區有大小不一的碎塊、粗糙裂邊、三層不等厚斜斷面及少量幾何岩屑；中心焦岩塌陷，周邊局部翹起、錯位，未做整顆蛋殼式等幅外翻。
- 裂口下方不保留完整地表，改成深暗岩體與斑駁熔融層；傷口內側點光照亮斷面，不新增爆光或粒子。雲層依破裂進度退開，修正 `Geometry.setColors()` 複製輸入後仍更新舊陣列的問題，直接更新實際 geometry colors。
- 本輪 factory smoke：所有幾何數值有限，法線長度 0.99999995–1.00000005；24 組地殼（含未破壞區）、48 個表皮／斷面 mesh 全部 OPAQUE。完全命中時原整球隱藏、4,044 個雲頂點 alpha 歸零；不同進度有實際位移，崩解與 reset 恢復通過。三段最新 WebGPU 畫面、建置、型別檢查及既有 10 個測試通過。
- 雲與大氣仍是薄殼近似，沒有體積散射或雲影；破裂是預製幾何演出，不是地質、流體或物理模擬。WebGL2 新美術與全片整合尚未驗證，美術質感仍待審閱。
- 戰艦交火預覽新增四艘相向運動的艦船、可轉向／俯仰的砲塔與有限速度彈道。發射位置來自實際砲口，命中解算至移動裝甲面；依序呈現護盾攔截、破口燃燒、致命命中與裝甲碎片冷卻漂移，不以任意閃光代替交火。
- 燃燒採沿破口外法線的擾動燃料噴流、焦痕與局部熱光；短暫爆燃後碎片持續散開、餘熱與光照消退，不是重力向上的煙柱或長留大火球。95 個實際燃燒 mesh 取樣確認噴流體積不穿入裝甲，12 秒時命中燈光全部歸零；這仍是幾何／shader 演出，不是流體或燃燒物理模擬。
- 最新建置、型別檢查與 17 個測試通過。WebGPU 實際播放交火、燃燒、擊毀、結尾與同頁重播，並驗證音效觸發／暫停時鐘和四段橫直向操作介面；原生音訊排程有觀測證據，但未確認喇叭聽感。戰艦交火仍僅限開發預覽，未整合正式 120 秒演出。

### 預覽量測

Apple M5（Mac17,3）、24 GiB RAM、Edge headless、WebGPU／HDR；CSS viewport 與實際 render target 均為 **1280×720**，瀏覽器 DPR 1、引擎 pixelRatio 1。下表為粗糙地殼斷面、雲層退開與深層熔融材質修正後，三段同頁切換至約 6 模擬秒、暖機後各 331 個樣本；CPU 是 native submission，不是整幀 CPU，GPU 是原生 pass-sum timestamp。

| 預覽 | 幀間隔 p50 / p95 / peak ms | CPU p95 / peak ms | GPU 最近 / session peak ms | 主 pass draws / triangles |
|---|---|---|---|---|
| 艦船掠過＋粒子尾流 | 16.70 / 17.50 / 17.80 | 1.40 / 1.60 | 29.03 / 45.61 | 23 / 215,736 |
| 命中裂口 | 16.60 / 17.60 / 17.80 | 2.60 / 3.60 | 40.70 / 63.05 | 52 / 229,764 |
| 崩解 | 16.60 / 17.60 / 18.40 | 1.60 / 3.20 | 37.88 / 63.05 | 10 / 83,596 |

GPU session peak 是同一次頁面執行至該段的累積最大值，**不是每段獨立 peak，也不是 p95**。RAF 幀間隔不等於 GPU 成本，GPU 尖峰仍超過 16.67 ms；不宣稱 60fps 認證。尚未驗證新美術全片、實體 Safari／手機、喇叭聽感或輔助科技認證；音樂聽感與美術方向仍待小語審閱，對外 Gate E 尚未通過。
