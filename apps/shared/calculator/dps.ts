import type { ClassRotationConfig, GameData, StatSheet } from "./types";
import { num } from "./stat-aggregation";
import { capDirectCrit, capDirectIntent } from "./rate-caps";

export function computeRotationDamage(
  e: StatSheet,
  config: ClassRotationConfig,
  classId: string,
  xinfaLoadout: string[],
  setId: string,
  gameData: GameData,
  healing: boolean,
): number {
  const ss = gameData.seasonStats;
  const checkXinfa = (name: string) => xinfaLoadout.includes(name);
  const hasSuoHen = checkXinfa("所恨年年") || classId === "牵丝霖";
  const hasDuanShi = checkXinfa("断石之构");
  const hasYiShui = checkXinfa("易水歌");

  // Determine dominant elemental type
  const eleMaxMap: Record<string, number> = {
    "破竹": num(e["最大破竹攻击"]),
    "鸣金": num(e["最大鸣金攻击"]),
    "裂石": num(e["最大裂石攻击"]),
    "牵丝": num(e["最大牵丝攻击"]),
    "无相": num(e["最大无相攻击"]),
  };
  let dominantEle = "无";
  let dominantMax = -1;
  for (const [ele, val] of Object.entries(eleMaxMap)) {
    if (val > dominantMax) { dominantMax = val; dominantEle = ele; }
  }

  const elePen = num(e["属攻穿透"]);
  const eleDmgBonus = num(e["属攻伤害加成"]);

  // Build stat block (D) matching reference
  const D = {
    minOuter: num(e["最小外功攻击"]),
    maxOuter: num(e["最大外功攻击"]),
    outerPen: num(e["外功穿透"]),
    minPoZhu: num(e["最小破竹攻击"]),
    maxPoZhu: num(e["最大破竹攻击"]),
    poZhuPen: num(e["破竹穿透"]) + (dominantEle === "破竹" ? elePen : 0),
    minMingJin: num(e["最小鸣金攻击"]),
    maxMingJin: num(e["最大鸣金攻击"]),
    mingJinPen: num(e["鸣金穿透"]) + (dominantEle === "鸣金" ? elePen : 0),
    minLieShi: num(e["最小裂石攻击"]),
    maxLieShi: num(e["最大裂石攻击"]),
    lieShiPen: num(e["裂石穿透"]) + (dominantEle === "裂石" ? elePen : 0),
    minQianSi: num(e["最小牵丝攻击"]),
    maxQianSi: num(e["最大牵丝攻击"]),
    qianSiPen: num(e["牵丝穿透"]) + (dominantEle === "牵丝" ? elePen : 0),
    minWuXiang: num(e["最小无相攻击"]),
    maxWuXiang: num(e["最大无相攻击"]),
    wuXiangPen: num(e["无相穿透"]) + (dominantEle === "无相" ? elePen : 0),
    outerDmgBonus: num(e["外功伤害加成"]),
    outerHealBonus: num(e["外功治疗加成"]),
    poZhuDmgBonus: num(e["破竹伤害加成"]) + eleDmgBonus,
    mingJinDmgBonus: num(e["鸣金伤害加成"]) + eleDmgBonus,
    lieShiDmgBonus: num(e["裂石伤害加成"]) + eleDmgBonus,
    qianSiDmgBonus: num(e["牵丝伤害加成"]) + eleDmgBonus,
    qiansiHealBonus: num(e["属攻治疗加成"]),
    precision: e["实际精准率"] !== undefined ? num(e["实际精准率"]) : num(e["精准率"]),
    critRate: e["实际会心率"] !== undefined ? num(e["实际会心率"]) : num(e["会心率"]),
    intentRate: e["实际会意率"] !== undefined ? num(e["实际会意率"]) : num(e["会意率"]),
    directCrit: capDirectCrit(num(e["直接会心率"])),
    directIntent: capDirectIntent(num(e["直接会意率"])),
    bossDmgBonus: num(e["对首领单位增伤"]),
    playerDmgBonus: num(e["对玩家单位增效"]),
    allArtsDmgBonus: num(e["全武学增效"]) || num(e["全武学增伤"]),
    singleMagicBonus: num(e["单体类奇术增伤"]) || num(e["单体奇术增伤"]),
    groupMagicBonus: num(e["群体类奇术增伤"]) || num(e["群体奇术增伤"]),
    specificSkillBonus: num(e["指定武学技能增伤"]),
    fixedDmgBonus: num(e["固伤加成"]) || num(ss["固伤加成"]),
    critDmgBonus: num(e["会心伤害加成"]),
    intentDmgBonus: num(e["会意伤害加成"]),
    critHealBonus: num(e["会心治疗加成"]),
  };

  // Weapon-type bonus map
  const weaponBonus: Record<string, number> = {
    "剑": num(e["剑武学增效"]),
    "枪": num(e["枪武学增效"]),
    "伞": num(e["伞武学增效"]),
    "扇": num(e["扇武学增效"]),
    "绳标": num(e["绳标武学增效"]),
    "双刀": num(e["双刀武学增效"]),
    "陌刀": num(e["陌刀武学增效"]),
    "横刀": num(e["横刀武学增效"]),
    "拳甲": num(e["拳甲武学增效"]),
  };

  // Boss defense with 所恨年年 reduction
  let bossDef = num(ss["BOSS防御"]);
  if (hasSuoHen) {
    bossDef += -0.06 * bossDef;
  }

  // ── Healing class (牵丝霖) calculation ──
  if (healing) {
    return computeHealDamage(D, weaponBonus, checkXinfa, setId, classId, ss);
  }

  // ── Normal DPS calculation ──
  const dmgFn = (atk: number, ratio: number, penMod: number, dmgMult: number, critMult: number) =>
    atk * ratio * (1 + penMod) * dmgMult * critMult;

  let totalK = 0;
  let includedR = 0;

  for (const entry of config.rotation) {
    const skillMaybe = config.skillDatabase[entry.name];
    if (!skillMaybe) continue;
    const skill = skillMaybe;

    const tiaozhan = entry.tiaozhan ?? 1;

    // Per-skill stat block (clone for per-skill modifications)
    const r = { ...D };

    // Elemental → add 无相 to matching element
    if (skill.element && skill.element !== "无" && skill.element !== "N/A") {
      const eleMap: Record<string, { min: string; max: string; pen: string }> = {
        "破竹": { min: "minPoZhu", max: "maxPoZhu", pen: "poZhuPen" },
        "鸣金": { min: "minMingJin", max: "maxMingJin", pen: "mingJinPen" },
        "裂石": { min: "minLieShi", max: "maxLieShi", pen: "lieShiPen" },
        "牵丝": { min: "minQianSi", max: "maxQianSi", pen: "qianSiPen" },
      };
      const mapped = eleMap[skill.element];
      if (mapped) {
        (r as Record<string, number>)[mapped.min] = ((r as Record<string, number>)[mapped.min] ?? 0) + r.minWuXiang;
        (r as Record<string, number>)[mapped.max] = ((r as Record<string, number>)[mapped.max] ?? 0) + r.maxWuXiang;
        (r as Record<string, number>)[mapped.pen] = ((r as Record<string, number>)[mapped.pen] ?? 0) + r.wuXiangPen;
      }
    }

    // ── Hit probabilities ──
    let critProb = r.critRate / 100 + (skill.exCrit || 0)
      + (setId === "浣花" ? 0.05 : 0);
    if (critProb > 0.8) critProb = 0.8;
    critProb += r.directCrit / 100;

    let intentProb = r.intentRate / 100 + (skill.exIntent || 0);
    if (intentProb > 0.4) intentProb = 0.4;
    intentProb += r.directIntent / 100;

    // 玉斗 set intent bonus
    if (setId === "玉斗" && skill.special !== "玉斗扣会意伤" &&
      !(classId === "鸣金虹" && !skill.modifiers?.["玉斗"])) {
      intentProb += 0.075;
    }
    if (skill.modifiers?.["长风"]) intentProb += 0.03;
    if (checkXinfa("凝神章")) intentProb += 0.03;

    let precisionProb = r.precision / 100;
    if (precisionProb > 1) precisionProb = 1;

    // Forced hit types
    const rawCritChance = r.precision / 100 * (r.critRate / 100 + r.directCrit / 100);
    if (skill.force === "会心" || (skill.force === "条件会心" && rawCritChance > 0.7)) {
      critProb = 1; intentProb = 0; precisionProb = 1;
    }
    if (skill.force === "会意") {
      critProb = 0; intentProb = 1; precisionProb = 1;
    }

    let glanceProb = (1 - precisionProb) * (1 - intentProb);
    if (skill.force === "不擦伤" || skill.weaponType === "陌刀") {
      glanceProb = 0;
    }

    const intentP = intentProb;
    const critP = (critProb + intentProb <= 1) ? critProb * precisionProb : precisionProb * (1 - intentProb);
    const normalP = Math.max(0, 1 - glanceProb - critP - intentP);

    // ── Global damage multiplier ──
    let globalMult = 0;
    if ((skill.type === "武器" || skill.type === "心法" || entry.name.includes("流血") || entry.name.includes("血爆")) && skill.weaponType !== "N/A") {
      globalMult += r.allArtsDmgBonus / 100;
    }
    if (skill.weaponType && weaponBonus[skill.weaponType]) {
      globalMult += weaponBonus[skill.weaponType]! / 100;
    }
    if (skill.weaponType === "单体奇术") {
      globalMult += r.singleMagicBonus / 100;
    }
    if (skill.weaponType === "群体奇术") {
      globalMult += r.groupMagicBonus / 100;
    }

    let T = 1 + entry.generalBonus + r.bossDmgBonus / 100 + globalMult;

    // Set bonuses on T
    if (setId === "连星") T += skill.modifiers?.["连星"] as number || 0;
    if (skill.isCharge === 1 && checkXinfa("威猛歌")) T += 0.15;
    if (checkXinfa("抗造大法")) T += 0.1;

    // 断岳 set
    let duanyueBonus = 0;
    if (setId === "断岳") {
      duanyueBonus = 0.05;
      if (skill.modifiers?.["断岳"]) duanyueBonus += 0.08;
    }
    T += duanyueBonus;

    if (skill.modifiers?.["烟柳"] && setId === "烟柳") T += 0.12;
    if (checkXinfa("征人归")) T += 0.08;
    if (checkXinfa("明晦同尘")) T += 0.05;
    if (entry.chunlei && checkXinfa("春雷篇")) T += 0.15;
    if (entry.name.includes("血爆") && checkXinfa("凝神章")) T += 0.1;

    // 飞隼/撼天 outer ATK percentage bonus
    let atkPctBonus = setId === "飞隼" ? 1.1 : setId === "撼天" ? 1.05 : 1;
    atkPctBonus += skill.exATK || 0;

    // Boss defense with per-skill modifiers
    let skillBossDef = bossDef + (skill.modifiers?.["恶身"] ? -0.1 * bossDef : 0);

    // Outer attack values
    let minOuterFinal = Math.max(0, r.minOuter + (atkPctBonus - 1) * r.minOuter - skillBossDef
      + num(ss["食物小外加成"]) + (skill.exMinATK || 0));
    let maxOuterFinal = Math.max(0, r.maxOuter + (atkPctBonus - 1) * r.maxOuter - skillBossDef
      + num(ss["食物大外加成"]) + (skill.exMaxATK || 0));
    if (skill.special === "陌刀天赋") maxOuterFinal += 120;
    if (maxOuterFinal < minOuterFinal) maxOuterFinal = minOuterFinal;
    const avgOuter = (minOuterFinal + maxOuterFinal) / 2;

    // Outer penetration (per-skill)
    const duanshiPen = (skill.modifiers?.["断石"] && hasDuanShi) ? 25 : 0;
    const yishuiPen = (hasYiShui && entry.yishui) ? entry.yishui : 0;
    const sanqiongPen = (skill.modifiers?.["三穷"] === 2 && checkXinfa("三穷致知")) ? 20 : 0;
    const chuanhouPen = (typeof skill.modifiers?.["穿喉"] === "number" && skill.modifiers["穿喉"] > 0 && checkXinfa("穿喉决"))
      ? skill.modifiers["穿喉"] as number : 0;
    const qiansiOuterPenExtra = classId === "牵丝霖" ? -num(ss["挑战外功抗性"]) : 0;
    const normalOuterResist = -num(ss["普通外功抗性"]);

    let outerPenFinal = (r.outerPen + (skill.exPen || 0) + duanshiPen + yishuiPen + sanqiongPen + chuanhouPen + qiansiOuterPenExtra + normalOuterResist) / 200;
    if (outerPenFinal < 0) outerPenFinal *= 2;

    // Outer damage bonus
    let outerDmgExtra = 0;
    if (skill.special === "鼠鼠") outerDmgExtra = 0.24;
    else if (skill.special === "回旋伞") outerDmgExtra = 0.12;
    let outerDmgFinal = r.outerDmgBonus / 100 + outerDmgExtra;
    if (classId === "破竹鸢" && !entry.name.includes("无返豆")) {
      outerDmgFinal += 0.09;
    }

    // Crit/intent damage multipliers
    let critDmgMult = 1 + r.critDmgBonus / 100 + (skill.exCritDmg || 0) + duanshiPen / 100;
    let intentDmgMult = 1 + r.intentDmgBonus / 100 + (skill.exIntentDmg || 0);

    if (classId === "鸣金虹" || classId === "鸣金影") {
      intentDmgMult += 0.1; // 秋暝帖
    } else {
      critDmgMult += 0.1; // 玄霄帖
    }
    if (skill.special === "玉斗扣会意伤" && setId === "玉斗") intentDmgMult -= 0.1;
    if (setId === "时雨") critDmgMult += 0.1;
    if (entry.name.includes("抗造盾") && checkXinfa("抗造大法") && setId === "时雨") critDmgMult += 0.15;
    if (setId === "浣花") critDmgMult += 0.15;
    if (entry.name.includes("Q") && checkXinfa("大唐歌")) critDmgMult += 0.15;
    if (setId === "玉斗") intentDmgMult += 0.1;
    if (checkXinfa("凝神章")) intentDmgMult += 0.1;
    if (skill.modifiers?.["移经"] && checkXinfa("移经易武")) critDmgMult += 0.2;
    if (typeof skill.modifiers?.["穿喉"] === "number" && skill.modifiers["穿喉"] > 0 && checkXinfa("穿喉决")) {
      critDmgMult += (skill.modifiers["穿喉"] as number) / 100;
    }

    // Outer damage per hit type
    const outerGlance = dmgFn(minOuterFinal, skill.outerRatio, outerPenFinal, 1 + outerDmgFinal, 1);
    const outerCrit = dmgFn(avgOuter, skill.outerRatio, outerPenFinal, 1 + outerDmgFinal, critDmgMult);
    const outerIntent = dmgFn(maxOuterFinal, skill.outerRatio, outerPenFinal, 1 + outerDmgFinal, intentDmgMult);
    const outerNormal = dmgFn(avgOuter, skill.outerRatio, outerPenFinal, 1 + outerDmgFinal, 1);
    const expectedOuter = outerGlance * glanceProb + outerCrit * critP + outerIntent * intentP + outerNormal * normalP;

    // Fixed damage
    let fixedVal = skill.fixed;
    if (skill.type === "武器") fixedVal += r.fixedDmgBonus * skill.fixed;
    const fixedPen = outerPenFinal;
    const fixedDmgMult = 1 + outerDmgFinal;
    const fixedGlance = dmgFn(fixedVal, 1, fixedPen, fixedDmgMult, 1);
    const fixedCrit = dmgFn(fixedVal, 1, fixedPen, fixedDmgMult, critDmgMult);
    const fixedIntent = dmgFn(fixedVal, 1, fixedPen, fixedDmgMult, intentDmgMult);
    const expectedFixed = fixedGlance * (glanceProb + normalP) + fixedCrit * critP + fixedIntent * intentP;

    // ── Elemental damage per element ──
    // Per-element penetration extras
    let sanqiongElePen = 0;
    if (skill.modifiers?.["三穷"] === 1 || (skill.modifiers?.["三穷"] === 2 && checkXinfa("三穷致知"))) {
      sanqiongElePen = 20;
    }
    let hantianElePen = 0;
    if ((skill.special === "撼天" || skill.special === "鼠鼠") && setId === "撼天") hantianElePen = 4;

    let poZhuExtraDmg = 0;
    if (classId === "破竹鸢" && !entry.name.includes("无返豆")) poZhuExtraDmg += 0.09;
    if (skill.special === "回旋伞") poZhuExtraDmg += 0.12;

    const eleExtraPen = skill.special === "额外全属性穿透" ? 16 : 0;
    const kuguoPen = skill.modifiers?.["苦果"] ? 10 : 0;
    const qiansiEleResist = classId === "牵丝霖" ? -num(ss["挑战属性抗性"]) : 0;
    const lieshiExtraPen = classId.includes("裂石钧") ? 12 : 0;
    const bleedExtraPen = (entry.name.includes("流血") || entry.name.includes("血爆")) ? 15 : 0;
    const normalEleResist = -num(ss["普通属性抗性"]);

    function computeEleDmg(
      element: string,
      minAtk: number,
      maxAtk: number,
      basePen: number,
      baseDmgBonus: number,
      extraDmg: number,
    ): number {
      const setMult = setId === "撼天" ? 1.05 : 1;
      const martialBonus = (skill.type === "武器" && skill.element === element)
        ? num(ss["武学常驻属性"]) * (1 + r.fixedDmgBonus) : 0;

      let minE = minAtk + (setMult - 1) * minAtk + martialBonus;
      let maxE = maxAtk + (setMult - 1) * maxAtk + martialBonus;
      if (maxE < minE) maxE = minE;
      const avgE = (minE + maxE) / 2;

      let penFinal = basePen < 0 ? basePen / 100 : basePen / 200;
      const ratio = skill.element === element ? skill.eleRatio : skill.outerRatio;
      const dmgBonus = (baseDmgBonus + extraDmg) / 100;

      const eGlance = dmgFn(minE, ratio, penFinal, 1 + dmgBonus, 1);
      const eNormal = dmgFn(avgE, ratio, penFinal, 1 + dmgBonus, 1);
      const eCrit = dmgFn(avgE, ratio, penFinal, 1 + dmgBonus, critDmgMult);
      const eIntent = dmgFn(maxE, ratio, penFinal, 1 + dmgBonus, intentDmgMult);
      return eGlance * glanceProb + eNormal * normalP + eCrit * critP + eIntent * intentP;
    }

    const poZhuPenTotal = r.poZhuPen + sanqiongElePen + hantianElePen + eleExtraPen + kuguoPen + qiansiEleResist + normalEleResist;
    const mingJinPenTotal = r.mingJinPen + sanqiongElePen + hantianElePen + eleExtraPen + bleedExtraPen + qiansiEleResist + normalEleResist;
    const lieShiPenTotal = r.lieShiPen + sanqiongElePen + hantianElePen + eleExtraPen + lieshiExtraPen + qiansiEleResist + normalEleResist;
    const qianSiPenTotal = r.qianSiPen + sanqiongElePen + hantianElePen + eleExtraPen + qiansiEleResist + normalEleResist;

    const poZhuExp = computeEleDmg("破竹", r.minPoZhu, r.maxPoZhu, poZhuPenTotal, r.poZhuDmgBonus, poZhuExtraDmg * 100);
    const mingJinExp = computeEleDmg("鸣金", r.minMingJin, r.maxMingJin, mingJinPenTotal, r.mingJinDmgBonus, 0);
    const lieShiExp = computeEleDmg("裂石", r.minLieShi, r.maxLieShi, lieShiPenTotal, r.lieShiDmgBonus, 0);
    const qianSiExp = computeEleDmg("牵丝", r.minQianSi, r.maxQianSi, qianSiPenTotal, r.qianSiDmgBonus, 0);

    let skillDamage = (expectedOuter + expectedFixed + poZhuExp + mingJinExp + lieShiExp + qianSiExp) * T;

    if (entry.isDingyin) {
      skillDamage *= (1 + r.specificSkillBonus / 100);
    }

    const entryDamage = skillDamage * entry.count * tiaozhan;
    totalK += entryDamage;
    if (entry.included) includedR += entryDamage;
  }

  // Settlement bonus (破竹尘 10%, 破竹风 30%)
  let settlementRate = 0;
  if (classId === "破竹尘") settlementRate = 0.1;
  if (classId === "破竹风") settlementRate = 0.3;
  if (settlementRate > 0) {
    totalK += includedR * settlementRate;
  }

  return totalK;
}

// ── Healing class (牵丝霖) calculation — matches reference exactly ──

function computeHealDamage(
  D: ReturnType<typeof Object.assign>,
  weaponBonus: Record<string, number>,
  checkXinfa: (name: string) => boolean,
  setId: string,
  _classId: string,
  ss: Record<string, number | string | boolean | Record<string, number>>,
): number {
  const healRatios = ss["霖霖治疗倍率"] as Record<string, number>;
  if (!healRatios) return 0;

  const r = { ...D };

  // Crit rate
  let critRate = r.critRate / 100 + (setId === "浣花" ? 0.05 : 0);
  if (critRate > 0.8) critRate = 0.8;
  critRate += r.directCrit / 100;

  // Crit heal multiplier
  let critHealMult = 1 + r.critHealBonus / 100;
  if (setId === "浣花") critHealMult += 0.15;
  if (setId === "时雨") critHealMult += 0.1;

  // Global heal multiplier
  let globalHeal = r.allArtsDmgBonus / 100 + (weaponBonus["扇"] ?? 0) / 100;
  if (checkXinfa("杏花不见")) globalHeal += 0.24;
  let totalMult = 1 + globalHeal;
  totalMult += 0.3; // 天赋
  totalMult += 0.05; // 易水歌
  if (checkXinfa("明晦同尘")) totalMult += 0.075;
  if (checkXinfa("征人归")) totalMult += 0.09;
  totalMult += r.playerDmgBonus / 100;

  // Add 无相 to 牵丝
  r.minQianSi += r.minWuXiang;
  r.maxQianSi += r.maxWuXiang;
  r.qianSiPen += r.wuXiangPen;
  r.outerPen += 10; // 易水歌

  // Outer heal
  const outerRatio = healRatios.outerRatio ?? 0;
  const avgOuter = (r.minOuter + r.maxOuter) / 2;
  const outerCritHeal = avgOuter * outerRatio * (1 + r.outerPen / 200) * totalMult * critHealMult;
  const outerNormalHeal = avgOuter * outerRatio * (1 + r.outerPen / 200) * totalMult;
  let expectedOuterHeal = outerCritHeal * critRate + outerNormalHeal * (1 - critRate);
  expectedOuterHeal *= 1 + r.outerHealBonus / 100;

  // Ele heal
  const eleRatio = healRatios.eleRatio ?? 0;
  const avgQianSi = (r.minQianSi + r.maxQianSi) / 2;
  const eleCritHeal = avgQianSi * eleRatio * (1 + r.qianSiPen / 200) * totalMult * critHealMult;
  const eleNormalHeal = avgQianSi * eleRatio * (1 + r.qianSiPen / 200) * totalMult;
  let expectedEleHeal = eleCritHeal * critRate + eleNormalHeal * (1 - critRate);
  expectedEleHeal *= 1 + r.qiansiHealBonus / 100;

  return (expectedOuterHeal + expectedEleHeal) * (1 + r.specificSkillBonus / 100);
}
