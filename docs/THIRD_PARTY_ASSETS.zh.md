# 第三方素材归属

[文档首页](../README.md) · [English version](./THIRD_PARTY_ASSETS.md)

## 职业图标

`apps/portal/components/shared/ClassGlyphIcon.tsx` 中的内置职业图标改编自 [Game Icons](https://game-icons.net/) 及其[官方 SVG 仓库](https://github.com/game-icons/icons)，按照 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) 使用。

归属：图标由 Delapouite 和 Lorc 创作，可在 https://game-icons.net 获取。

改动说明：移除源文件的黑色背景路径，将前景路径作为本地 React SVG 数据嵌入，并使用 `currentColor` 与门户职业标记尺寸渲染；运行时不会加载远程素材。

| 作者 | 门户图标 ID | 上游 SVG 名称 |
| --- | --- | --- |
| [Delapouite](https://game-icons.net/about.html#authors) | `axe`, `spear`, `trident`, `hammer`, `claw`, `gauntlet`, `shield`, `bow`, `target`, `bomb`, `staff`, `wand`, `orb`, `gem`, `sparkles`, `flame`, `bolt`, `moon`, `sun`, `heart`, `heartbeat`, `potion`, `leaf`, `book`, `scroll`, `lute`, `crown`, `trophy`, `flag`, `mask`, `pendant`, `boot`, `skull`, `dice` | `war-axe`, `spear-feather`, `magic-trident`, `warhammer`, `wolverine-claws`, `gauntlet`, `shield-bash`, `bow-arrow`, `convergence-target`, `bolt-bomb`, `crescent-staff`, `lunar-wand`, `dragon-orb`, `fire-gem`, `yin-yang`, `fire-spell-cast`, `lightning-flame`, `moon-orbit`, `sun-priest`, `healing`, `heart-beats`, `magic-potion`, `solid-leaf`, `spell-book`, `scroll-quill`, `harp`, `crenel-crown`, `trophy-cup`, `tower-flag`, `ceremonial-mask`, `tribal-pendant`, `metal-boot`, `skull-staff`, `perspective-dice-six-faces-random` |
| [Lorc](https://game-icons.net/about.html#authors) | `sword`, `swords`, `dagger`, `scythe`, `target-arrow`, `snowflake`, `chalice`, `rings` | `sword-array`, `crossed-swords`, `broad-dagger`, `reaper-scythe`, `target-arrows`, `snowflake-1`, `jeweled-chalice`, `linked-rings` |

权威的上游归属及贡献者许可清单以 Game Icons 的[许可证文件](https://github.com/game-icons/icons/blob/master/license.txt)为准。

## README 图表

`docs/diagrams/` 中的中英文图表由 Archify 2.16 根据项目自有的 JSON 规格生成，源文件与 SVG 一同保存。图表无需外部资源即可适配明暗主题。导出的渲染样式保留 [Archify MIT 许可声明](./diagrams/LICENSE)，归属于 tt-a1i 与 Cocoon AI。
