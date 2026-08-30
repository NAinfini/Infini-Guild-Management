# Third-party asset credits / 第三方素材归属

## Class glyphs / 职业图标

The built-in class glyphs in `apps/portal/components/shared/ClassGlyphIcon.tsx` are adapted from [Game Icons](https://game-icons.net/) and its [official SVG repository](https://github.com/game-icons/icons). They are licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

内置职业图标改编自 [Game Icons](https://game-icons.net/) 及其[官方 SVG 仓库](https://github.com/game-icons/icons)，按照 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) 使用。

Attribution: Icons made by Delapouite and Lorc. Available on https://game-icons.net.

Adaptations: the source black background paths were removed; the foreground paths are embedded as local React SVG data, rendered with `currentColor`, and scaled for the portal's class markers. No remote asset is loaded at runtime.

改动说明：移除源文件的黑色背景路径，将前景路径作为本地 React SVG 数据嵌入，并使用 `currentColor` 与门户职业标记尺寸渲染；运行时不会加载远程素材。

| Author | Portal icon IDs | Upstream SVG names |
| --- | --- | --- |
| [Delapouite](https://game-icons.net/about.html#authors) | `axe`, `spear`, `trident`, `hammer`, `claw`, `gauntlet`, `shield`, `bow`, `target`, `bomb`, `staff`, `wand`, `orb`, `gem`, `sparkles`, `flame`, `bolt`, `moon`, `sun`, `heart`, `heartbeat`, `potion`, `leaf`, `book`, `scroll`, `lute`, `crown`, `trophy`, `flag`, `mask`, `pendant`, `boot`, `skull`, `dice` | `war-axe`, `spear-feather`, `magic-trident`, `warhammer`, `wolverine-claws`, `gauntlet`, `shield-bash`, `bow-arrow`, `convergence-target`, `bolt-bomb`, `crescent-staff`, `lunar-wand`, `dragon-orb`, `fire-gem`, `yin-yang`, `fire-spell-cast`, `lightning-flame`, `moon-orbit`, `sun-priest`, `healing`, `heart-beats`, `magic-potion`, `solid-leaf`, `spell-book`, `scroll-quill`, `harp`, `crenel-crown`, `trophy-cup`, `tower-flag`, `ceremonial-mask`, `tribal-pendant`, `metal-boot`, `skull-staff`, `perspective-dice-six-faces-random` |
| [Lorc](https://game-icons.net/about.html#authors) | `sword`, `swords`, `dagger`, `scythe`, `target-arrow`, `snowflake`, `chalice`, `rings` | `sword-array`, `crossed-swords`, `broad-dagger`, `reaper-scythe`, `target-arrows`, `snowflake-1`, `jeweled-chalice`, `linked-rings` |

The authoritative upstream attribution and contributor license list remains the Game Icons [license file](https://github.com/game-icons/icons/blob/master/license.txt).
