import type {
  Equipment,
  GameData,
  StatSheet,
  RateBreakdown,
  LoanDingyinStats,
} from "./types";
import { addStat, num } from "./stat-aggregation";
import { capDirectCrit, capDirectIntent } from "./rate-caps";
import { getBaselineByClass, isHealingClass } from "./class-rules";
import { computeRotationDamage } from "./dps";
export { capRates } from "./rate-caps";

// ── helpers ──

export function getStatQuality(statType: string, value: number, gameData: GameData): number {
  const max = gameData.maxValues[statType];
  if (!max || max <= 0) return 0;
  return Math.min(100, (value / max) * 100);
}

// ── Five-dimension talent config per class (matching reference exactly) ──

type FiveDimConfig = {
  stat: string;
  grants: { stat: string; seasonKey: string }[];
};

const FIVE_DIM_CONFIG: Record<string, FiveDimConfig> = {
  "鸣金虹": {
    stat: "势",
    grants: [
      { stat: "会意率", seasonKey: "五维天赋会意" },
      { stat: "最大外功攻击", seasonKey: "五维天赋外功" },
    ],
  },
  "鸣金影": {
    stat: "劲",
    grants: [
      { stat: "会意率", seasonKey: "五维天赋会意" },
      { stat: "最大外功攻击", seasonKey: "五维天赋外功" },
    ],
  },
  "裂石威": {
    stat: "劲",
    grants: [
      { stat: "会心率", seasonKey: "五维天赋会心" },
    ],
  },
  "破竹鸢": { stat: "敏", grants: [{ stat: "会心率", seasonKey: "五维天赋会心" }, { stat: "最小外功攻击", seasonKey: "五维天赋外功" }] },
  "破竹尘": { stat: "敏", grants: [{ stat: "会心率", seasonKey: "五维天赋会心" }, { stat: "最小外功攻击", seasonKey: "五维天赋外功" }] },
  "破竹风": { stat: "敏", grants: [{ stat: "会心率", seasonKey: "五维天赋会心" }, { stat: "最小外功攻击", seasonKey: "五维天赋外功" }] },
  "牵丝玉": { stat: "敏", grants: [{ stat: "会心率", seasonKey: "五维天赋会心" }, { stat: "最小外功攻击", seasonKey: "五维天赋外功" }] },
  "牵丝霖": { stat: "敏", grants: [{ stat: "会心率", seasonKey: "五维天赋会心" }, { stat: "最小外功攻击", seasonKey: "五维天赋外功" }] },
  "裂石钧": { stat: "敏", grants: [{ stat: "会心率", seasonKey: "五维天赋会心" }, { stat: "最小外功攻击", seasonKey: "五维天赋外功" }] },
  "裂石钧（纯唐）": { stat: "敏", grants: [{ stat: "会心率", seasonKey: "五维天赋会心" }, { stat: "最小外功攻击", seasonKey: "五维天赋外功" }] },
};

// ── Step 1: calculateTotal — matches reference Calculator.calculateTotal exactly ──

export function calculateTotal(
  equippedItems: Record<string, Equipment | undefined>,
  classId: string,
  bowType: string,
  xinfaLoadout: string[],
  setId: string,
  earlySeasonBonus: boolean,
  loanDingyin: boolean,
  loanDingyinStats: LoanDingyinStats | undefined,
  armoryType: string,
  gameData: GameData,
): StatSheet {
  const ss = gameData.seasonStats;
  const stats: StatSheet = { ...gameData.baseStats };
  let baseDim = num(gameData.baseStats["敏"]);

  // Elemental prefix from class name (first 2 chars)
  const elePrefix = classId ? classId.substring(0, 2) : "";

  // Talent elemental attack
  if (elePrefix) {
    addStat(stats, `最小${elePrefix}攻击`, num(ss["天赋最小属攻"]));
    addStat(stats, `最大${elePrefix}攻击`, num(ss["天赋最大属攻"]));
  }

  // Armory bonus — reference: armoryType !== "通用" → add to elemental, else add to outer
  if (armoryType !== "通用") {
    addStat(stats, `最小${armoryType}攻击`, num(ss["武库最小值"]));
    addStat(stats, `最大${armoryType}攻击`, num(ss["武库最大值"]));
  } else {
    addStat(stats, "最小外功攻击", num(ss["武库最小值"]));
    addStat(stats, "最大外功攻击", num(ss["武库最大值"]));
  }

  // Talent elemental damage bonus (not for 牵丝霖)
  if (elePrefix && classId !== "牵丝霖") {
    addStat(stats, `${elePrefix}伤害加成`, num(ss["天赋属性增伤"]));
  }

  // Equipment stats
  for (const equip of Object.values(equippedItems)) {
    if (!equip) continue;

    // Slot base outer attack
    if (equip.slotId === "1") {
      const minKey = equip.isPurple ? "紫装武器最小外功" : "金装武器最小外功";
      const maxKey = equip.isPurple ? "紫装武器最大外功" : "金装武器最大外功";
      addStat(stats, "最小外功攻击", num(ss[minKey]));
      addStat(stats, "最大外功攻击", num(ss[maxKey]));
    } else if (equip.slotId === "3") {
      const key = equip.isPurple ? "紫装环最小外功" : "金装环最小外功";
      addStat(stats, "最小外功攻击", num(ss[key]));
    } else if (equip.slotId === "4") {
      const key = equip.isPurple ? "紫装佩最大外功" : "金装佩最大外功";
      addStat(stats, "最大外功攻击", num(ss[key]));
    }

    // Main stat (reference: addStatWithTrack applies chengyin 0.94 multiplier)
    if (equip.mainStat?.type && equip.mainStat.type !== "生存类词条" && equip.mainStat.type !== "生存向") {
      const val = equip.isChengyin
        ? 0.94 * (gameData.maxValues[equip.mainStat.type] ?? equip.mainStat.value)
        : equip.mainStat.value;
      addStat(stats, equip.mainStat.type, val);
    }

    // Dingyin stat (skip if loan dingyin)
    if (equip.dingyinStat?.type && !loanDingyin) {
      addStat(stats, equip.dingyinStat.type, equip.dingyinStat.value);
    }

    // Sub stats (reference: addStatWithTrack applies chengyin 0.94 multiplier)
    for (const sub of equip.subStats) {
      if (sub.type === "生存类词条" || sub.type === "生存向") continue;
      const val = equip.isChengyin
        ? 0.94 * (gameData.maxValues[sub.type] ?? sub.value)
        : sub.value;
      addStat(stats, sub.type, val);
    }
  }

  // Loan dingyin stats
  if (loanDingyin && loanDingyinStats) {
    stats["外功穿透"] = loanDingyinStats.outerPenetration;
    addStat(stats, "属攻穿透", loanDingyinStats.elePenetration);
    stats["指定武学技能增伤"] = loanDingyinStats.specificSkillBonus;
  }

  // Xinfa bonuses
  for (const xinfaId of xinfaLoadout) {
    const xinfa = gameData.xinfaData[xinfaId];
    if (!xinfa) continue;
    for (const [stat, value] of Object.entries(xinfa)) {
      addStat(stats, stat, value);
    }
  }

  // Set bonus
  const set = gameData.setData[setId];
  if (set) {
    for (const [stat, value] of Object.entries(set)) {
      addStat(stats, stat, value);
    }
  }

  // Early season bonus
  if (earlySeasonBonus && ss["当前是上半赛季"]) {
    stats["劲"] = (stats["劲"] ?? 0) + 20;
    stats["敏"] = (stats["敏"] ?? 0) + 20;
    stats["势"] = (stats["势"] ?? 0) + 20;
    baseDim += 20;
    addStat(stats, "精准率", 1.6);
  }

  // Five-dimension attribute conversion
  const jin = stats["劲"] ?? 0;
  const min = stats["敏"] ?? 0;
  const shi = stats["势"] ?? 0;

  stats["最小外功攻击"] = (stats["最小外功攻击"] ?? 0) + 0.22 * jin + 0.9 * min;
  stats["最大外功攻击"] = (stats["最大外功攻击"] ?? 0) + 1.36 * jin + 0.9 * shi;
  stats["会心率"] = (stats["会心率"] ?? 0) + 0.076 * min;
  stats["会意率"] = (stats["会意率"] ?? 0) + 0.038 * shi;

  // Class-specific 5D talent conversion
  const fiveDimCap = num(ss["五维天赋加成上限"]);
  const fiveDimCfg = FIVE_DIM_CONFIG[classId];
  if (fiveDimCfg && fiveDimCap > 0) {
    const dimVal = Math.min(stats[fiveDimCfg.stat] ?? 0, fiveDimCap);
    const ratio = dimVal / fiveDimCap;
    for (const grant of fiveDimCfg.grants) {
      addStat(stats, grant.stat, num(ss[grant.seasonKey]) * ratio);
    }
  }

  // Bow type bonus
  if (bowType === "precision") {
    addStat(stats, "精准率", num(ss["精准弓加成"]));
  } else if (bowType === "crit") {
    addStat(stats, "会心率", num(ss["会心弓加成"]));
  } else if (bowType === "intent") {
    addStat(stats, "会意率", num(ss["会意弓加成"]));
  }

  // ── Cap rates (matching reference exactly) ──
  const seasonResist = num(ss["赛季抗性"]);
  const basePrecision = num(ss["基础精准率"]);

  // Crit rate with class/set bonus
  let critExtra = 0;
  if (classId === "裂石威") critExtra += 24;
  if (setId === "浣花") critExtra += 5;

  let actualCrit = (stats["会心率"] ?? 0) / seasonResist + critExtra;
  let critOverflow = 0;
  if (actualCrit > 80) {
    critOverflow = (actualCrit - 80) * seasonResist;
    actualCrit -= critExtra;
    if (actualCrit > 80) actualCrit = 80;
  } else if (critExtra !== 0) {
    actualCrit -= critExtra;
  }

  let actualIntent = (stats["会意率"] ?? 0) / seasonResist;
  let intentOverflow = 0;
  if (actualIntent > 40) {
    intentOverflow = (actualIntent - 40) * seasonResist;
    actualIntent = 40;
  }

  let actualPrecision = ((stats["精准率"] ?? 0) - basePrecision) / seasonResist + basePrecision;
  let precisionOverflow = 0;
  if (actualPrecision > 100) {
    precisionOverflow = (actualPrecision - 100) * seasonResist;
    actualPrecision = 100;
  }

  // Cross-cap overflow (crit + intent + directCrit + directIntent > 100)
  const directCrit = capDirectCrit(stats["直接会心率"] ?? 0);
  const directIntent = capDirectIntent(stats["直接会意率"] ?? 0);
  const cappedCritForCheck = (actualCrit + critExtra > 80) ? 80 : actualCrit + critExtra;
  if (actualIntent + cappedCritForCheck + directCrit + directIntent > 100) {
    const extraOverflow = (actualIntent + cappedCritForCheck + directCrit + directIntent - 100) * seasonResist;
    critOverflow += extraOverflow;
  }

  // 裂石钧 special crit overflow
  if (classId === "裂石钧") {
    const critCap = (70 - directCrit * actualPrecision / 100) / actualPrecision * 100;
    if (actualCrit > critCap) {
      critOverflow = (actualCrit - critCap) * seasonResist;
    }
  }

  stats["实际会心率"] = actualCrit;
  stats["会心率溢出"] = critOverflow;
  stats["实际会意率"] = actualIntent;
  stats["会意率溢出"] = intentOverflow;
  stats["实际精准率"] = actualPrecision;
  stats["精准率溢出"] = precisionOverflow;

  // Clean up raw 劲/敏/势/精准率/会心率/会意率 (reference deletes them)
  delete stats["劲"];
  delete stats["敏"];
  delete stats["势"];
  delete stats["精准率"];
  delete stats["会心率"];
  delete stats["会意率"];

  // Healing class adjustments
  if (isHealingClass(classId, xinfaLoadout)) {
    stats["属攻治疗加成"] = num(ss["天赋属性增伤"]);
  } else {
    delete stats["会心治疗加成"];
    delete stats["外功治疗加成"];
    if (classId === "牵丝霖") {
      delete stats["指定武学技能增伤"];
    }
  }

  return stats;
}

// ── Step 2: Cap rates accessor (for UI display) ──

export function calculateGraduationRate(
  rawStats: StatSheet,
  classId: string,
  xinfaLoadout: string[],
  setId: string,
  gameData: GameData,
  options?: { skipExcelRate?: boolean },
): { graduationRate: number; excelRate: number; expectedDps: number; details: RateBreakdown } {
  const rotationConfig = gameData.rotations[classId];
  if (!rotationConfig || rotationConfig.rotation.length === 0) {
    return {
      graduationRate: 0,
      excelRate: 0,
      expectedDps: 0,
      details: { totalRate: 0, excelRate: 0, perSlotRates: {}, perStatContributions: {}, baselineDps: 0, playerDps: 0 },
    };
  }

  const healing = isHealingClass(classId, xinfaLoadout);

  const e: StatSheet = { ...rawStats };

  // Compute total damage from the rotation
  const totalDamage = computeRotationDamage(e, rotationConfig, classId, xinfaLoadout, setId, gameData, healing);

  // Get baseline
  const baseline = getBaselineByClass(classId, xinfaLoadout, rotationConfig, healing);
  const graduationRate = baseline > 0 ? (totalDamage / baseline) * 100 : 0;

  // DPS (totalDamage / useTime)
  const useTime = rotationConfig.useTime || 1;
  const expectedDps = healing ? Math.round(totalDamage) : Math.round(totalDamage / useTime);

  // Excel rate: the reference passes rounded stats (percent → 1 decimal, others → integer)
  // then recalculates. We approximate this by truncating the rate.
  let excelRate = graduationRate; // default: same as graduation rate
  if (!options?.skipExcelRate) {
    const roundedStats = { ...rawStats };
    for (const key of Object.keys(roundedStats)) {
      const val = roundedStats[key]!;
      const isPct = gameData.percentStats.includes(key) ||
        key.includes("率") || key.includes("增效") || key.includes("加成") || key.includes("增伤") || key.includes("穿透");
      roundedStats[key] = isPct ? parseFloat(val.toFixed(1)) : Math.round(val);
    }
    const roundedE: StatSheet = { ...roundedStats };
    const excelDamage = computeRotationDamage(roundedE, rotationConfig, classId, xinfaLoadout, setId, gameData, healing);
    excelRate = baseline > 0 ? (excelDamage / baseline) * 100 : 0;
  }

  return {
    graduationRate: parseFloat(graduationRate.toFixed(2)),
    excelRate: parseFloat(excelRate.toFixed(2)),
    expectedDps,
    details: {
      totalRate: graduationRate,
      excelRate,
      perSlotRates: {},
      perStatContributions: {},
      baselineDps: baseline,
      playerDps: totalDamage,
    },
  };
}


// ── Core DPS engine — per-skill calculation matching reference exactly ──
