# 乐队 logo

22 个主体的官方 logo（字标），规整成透明背景 PNG 放在这里，给邮件头图和站内展示用。
文件名就是主体 id，和 `industry/taxonomy.ts` 里 `ENTITIES` 的键一一对应（22 个）。

- `<id>.png`：处理后的图。裁掉了透明边距、保留了 alpha、最长边不超过 1200px。
- `manifest.json`：渲染代码读这份清单，不要硬编码尺寸。

## manifest.json

```json
{
  "generatedAt": "2026-10-04T08:03:29.026Z",
  "logos": {
    "<id>": {
      "file": "<id>.png",
      "source": "抓取时的直链",
      "sha256": "处理后 PNG 的 sha256",
      "width": 1088,
      "height": 164,
      "inkLum": 0.0,
      "onDark": false
    }
  }
}
```

- `inkLum`：不透明像素（alpha > 200）的平均相对亮度（WCAG，sRGB 先线性化），0..1；没有不透明像素时为 `null`。
- `onDark`：`inkLum >= 0.55`，即这支 logo 压在深色底上还看得清。**当前有 5 支为 true**（our-notes、kuzumimizuku、diamond-dust、canna-lily、f-272）；girls-band-cry、kessoku-band、afterglow 的墨迹几乎全黑（前两支 100% 是纯 `#000`），深色底上等于隐形。
- `inkLum` 是平均值，不是保证：kuzumimizuku 平均 0.6675（`onDark: true`），但仍有 32% 的墨迹是深色，压在深色底上会掉一半；our-notes 同理（17% 深色墨迹）。深色底上要稳妥，得看 `file` 本身，别只看这一个数。
- 只写抓取成功的条目。某个 id 抓不到时它不会出现在 `logos` 里，渲染代码要按缺项兜底。

## 来源

三个官方站点，直链规律：

| 站点 | 路径规律 |
| --- | --- |
| `girls-band-cry.com` | `/wp-content/themes/gbc_v1-1/assets/images/common/logo.png`（作品 logo）；同站乐队在 `.../common/character/logo_*.png`（togenashi-togeari、diamond-dust） |
| `bang-dream.com` | `/wordpress/wp-content/themes/bangdream-portal/assets/webp/common/artist/logo_<slug>.webp`（企划内各乐队）；综合站 logo 与 our-notes 在 `.../assets/images/common/common/logo_*.png` |
| `bocchi.rocks` | `/kessokuband/assets/img/common/header/logo_kessoku.svg`（結束バンド）；作品自己的字标在 `/tv/assets/img/common/footer/ttl_logo.svg`（bocchi-the-rock）。两个都是 SVG，脚本按 600dpi 栅格化 |
| `gbc-firstriff.com` | `/wp-content/themes/gbc-firstriff_teaser/assets/images/band/<id>/img_logo-band-<id>.png`（canna-lily、f-272、kuzumimizuku） |

`bang-dream.com` 和 `gbc-firstriff.com` 不带 `Referer` 会 403，脚本对每个请求都带同源 Referer 和正常浏览器 UA。

## 重新生成

```bash
node scripts/fetch-band-logos.ts
```

脚本在 stdout 打一张逐行表（id、状态、尺寸、字节、inkLum、onDark、来源），最后一行是 `抓取 N/22，失败 M`。
处理流程是 **按 alpha 通道求墨迹包围盒裁边** → `ensureAlpha()` → `resize(fit: "inside", withoutEnlargement: true)`（≤1200px）→ `png({ compressionLevel: 9 })`。

裁边为什么不用 `sharp.trim()`：它拿**左上角像素的 RGB** 当背景比对，不看 alpha。GIRLS BAND CRY 的源图透明区 RGB 是杂色的（`(71,112,76,0)` vs 左上角 `(71,70,76,0)`），`trim({ threshold: 1 })` 对它**完全没作用**，留白基准就崩了。脚本改成量 alpha：**alpha > 8 才算画面**（源图边缘常有一圈 alpha ≤ 8 ≈ 3% 的不可见像素，不设这个下限包围盒会贴到整张画布、等于不裁），软阴影和发光的 alpha 远高于 8，属于画面、会被保留。
单条失败只记一行、继续下一条，退出码仍是 0。幂等：源没变时重复跑不改动任何文件的字节（连 `generatedAt` 都保留）。

## 版权

这些图是各权利人的官方商标 / 字号（GIRLS BAND CRY、トゲナシトゲアリ、BanG Dream!、結束バンド、MyGO!!!!!、Ave Mujica、Roselia、Poppin'Party、Afterglow、Pastel*Palettes、ハロー、ハッピーワールド！、Morfonica、RAISE A SUILEN、夢限大みゅーたいぷ、Our Notes、millsage、一家Dumb Rock!、Canna Lily、F-272、クズミミズク、ダイヤモンドダスト、ぼっち・ざ・ろっく！），版权归各自权利人所有。

**只用于本站的邮件头图与站内展示，不是我们的素材**：不要拿去再分发、不要用于其他项目、不要商用，也不要当成站点自己的品牌标志。仓库的 MIT 许可不覆盖 `assets/band-logos/` 下的这些图片。
