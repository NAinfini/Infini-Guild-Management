import seedGameData from "./seed-data.json";
import { describe, expect, it } from "vitest";
import { gameDataSchema } from "../schemas/equipment-calc";
import { calculateGraduationRate, calculateTotal, capRates } from "./engine";
import type { GameData, StatSheet } from "./types";

const gameData: GameData = gameDataSchema.parse(seedGameData);

function getArmoryType(classId: string): string {
  const at = classId.substring(0, 2);
  return ["鸣金", "裂石", "牵丝", "破竹"].includes(at) ? at : "通用";
}

const REFERENCE_DEFAULT_LOADOUTS = [
  { classId: "鸣金虹", damage: 2392063, rate: 19.96, excelRate: 19.96, expectedDps: 22356 },
  { classId: "鸣金影", damage: 1861588, rate: 21.54, excelRate: 21.54, expectedDps: 24477 },
  { classId: "破竹尘", damage: 2281080, rate: 20.5, excelRate: 20.5, expectedDps: 23444 },
  { classId: "破竹风", damage: 1646021, rate: 21.12, excelRate: 21.11, expectedDps: 21904 },
  { classId: "破竹鸢", damage: 1756439, rate: 21.69, excelRate: 21.68, expectedDps: 22841 },
  { classId: "裂石威", damage: 2497326, rate: 21.75, excelRate: 21.75, expectedDps: 23231 },
  { classId: "裂石钧", damage: 2340961, rate: 27, excelRate: 27, expectedDps: 31635 },
  { classId: "裂石钧（纯唐）", damage: 248748, rate: 26.15, excelRate: 26.16, expectedDps: 17768 },
  { classId: "牵丝霖", damage: 894632, rate: 23.39, excelRate: 23.39, expectedDps: 4970 },
  { classId: "牵丝玉", damage: 1850090, rate: 21.32, excelRate: 21.32, expectedDps: 24343 },
  { classId: "牵丝翊", damage: 1606741, rate: 16, excelRate: 16, expectedDps: 14905 },
];

describe("equipment calculator engine", () => {
  it("matches reference calculator outputs for default no-equipment loadouts", () => {
    for (const expected of REFERENCE_DEFAULT_LOADOUTS) {
      const xinfaLoadout = gameData.xinfaRules[expected.classId]?.default ?? [];
      const setId = gameData.defaultSets[expected.classId] ?? "";
      const stats = calculateTotal(
        {},
        expected.classId,
        "",
        xinfaLoadout,
        setId,
        false,
        false,
        undefined,
        "通用",
        gameData,
      );

      const result = calculateGraduationRate(stats, expected.classId, xinfaLoadout, setId, gameData);

      expect(Math.round(result.details.playerDps), `${expected.classId} damage`).toBe(expected.damage);
      expect(result.graduationRate, `${expected.classId} graduation rate`).toBe(expected.rate);
      expect(result.excelRate, `${expected.classId} excel rate`).toBe(expected.excelRate);
      expect(result.expectedDps, `${expected.classId} expected dps`).toBe(expected.expectedDps);
    }
  });

  it("matches reference outputs with early season bonus", () => {
    const EARLY_SEASON_CASES = [
      { classId: "破竹尘", damage: 2468939, rate: 22.19, excelRate: 22.19, expectedDps: 25375 },
      { classId: "破竹鸢", damage: 1937082, rate: 23.92, excelRate: 23.92, expectedDps: 25190 },
      { classId: "裂石威", damage: 2751155, rate: 23.96, excelRate: 23.97, expectedDps: 25592 },
      { classId: "鸣金虹", damage: 2621087, rate: 21.88, excelRate: 21.87, expectedDps: 24496 },
      { classId: "牵丝玉", damage: 2005797, rate: 23.12, excelRate: 23.12, expectedDps: 26392 },
      { classId: "破竹风", damage: 1776905, rate: 22.79, excelRate: 22.79, expectedDps: 23645 },
      { classId: "裂石钧", damage: 2550801, rate: 29.42, excelRate: 29.42, expectedDps: 34470 },
      { classId: "鸣金影", damage: 2054516, rate: 23.77, excelRate: 23.77, expectedDps: 27014 },
      { classId: "牵丝霖", damage: 979293, rate: 25.6, excelRate: 25.61, expectedDps: 5441 },
      { classId: "裂石钧（纯唐）", damage: 270155, rate: 28.4, excelRate: 28.4, expectedDps: 19297 },
      { classId: "牵丝翊", damage: 1723681, rate: 17.17, excelRate: 17.16, expectedDps: 15990 },
    ];

    for (const expected of EARLY_SEASON_CASES) {
      const xinfaLoadout = gameData.xinfaRules[expected.classId]?.default ?? [];
      const setId = gameData.defaultSets[expected.classId] ?? "";
      const armoryType = ["鸣金", "裂石", "牵丝", "破竹"].includes(expected.classId.substring(0, 2))
        ? expected.classId.substring(0, 2) : "通用";
      const stats = calculateTotal({}, expected.classId, "", xinfaLoadout, setId, true, false, undefined, armoryType, gameData);
      const result = calculateGraduationRate(stats, expected.classId, xinfaLoadout, setId, gameData);

      expect(Math.round(result.details.playerDps), `${expected.classId} damage`).toBe(expected.damage);
      expect(result.graduationRate, `${expected.classId} graduation rate`).toBe(expected.rate);
      expect(result.excelRate, `${expected.classId} excel rate`).toBe(expected.excelRate);
      expect(result.expectedDps, `${expected.classId} expected dps`).toBe(expected.expectedDps);
    }
  });

  it("matches reference outputs with alternate sets", () => {
    const ALT_SET_CASES = [
      { classId: "鸣金虹", setId: "飞隼", damage: 2669711, rate: 22.28, excelRate: 22.29, expectedDps: 24951 },
      { classId: "鸣金影", setId: "玉斗", damage: 2087692, rate: 24.15, excelRate: 24.14, expectedDps: 27450 },
      { classId: "破竹尘", setId: "飞隼", damage: 2531320, rate: 22.75, excelRate: 22.75, expectedDps: 26016 },
      { classId: "破竹风", setId: "玉斗", damage: 1739146, rate: 22.31, excelRate: 22.31, expectedDps: 23143 },
      { classId: "破竹鸢", setId: "飞隼", damage: 1896439, rate: 23.41, excelRate: 23.41, expectedDps: 24661 },
      { classId: "裂石威", setId: "飞隼", damage: 2718805, rate: 23.68, excelRate: 23.67, expectedDps: 25291 },
      { classId: "裂石钧", setId: "飞隼", damage: 2531584, rate: 29.2, excelRate: 29.2, expectedDps: 34211 },
      { classId: "裂石钧（纯唐）", setId: "飞隼", damage: 260943, rate: 27.43, excelRate: 27.43, expectedDps: 18639 },
      { classId: "牵丝霖", setId: "飞隼", damage: 985554, rate: 25.76, excelRate: 25.76, expectedDps: 5475 },
      { classId: "牵丝玉", setId: "玉斗", damage: 1977339, rate: 22.79, excelRate: 22.79, expectedDps: 26018 },
      { classId: "牵丝翊", setId: "时雨", damage: 1639710, rate: 16.33, excelRate: 16.33, expectedDps: 15211 },
    ];

    for (const expected of ALT_SET_CASES) {
      const xinfaLoadout = gameData.xinfaRules[expected.classId]?.default ?? [];
      const armoryType = ["鸣金", "裂石", "牵丝", "破竹"].includes(expected.classId.substring(0, 2))
        ? expected.classId.substring(0, 2) : "通用";
      const stats = calculateTotal({}, expected.classId, "", xinfaLoadout, expected.setId, false, false, undefined, armoryType, gameData);
      const result = calculateGraduationRate(stats, expected.classId, xinfaLoadout, expected.setId, gameData);

      expect(Math.round(result.details.playerDps), `${expected.classId} ${expected.setId} damage`).toBe(expected.damage);
      expect(result.graduationRate, `${expected.classId} ${expected.setId} graduation rate`).toBe(expected.rate);
      expect(result.excelRate, `${expected.classId} ${expected.setId} excel rate`).toBe(expected.excelRate);
      expect(result.expectedDps, `${expected.classId} ${expected.setId} expected dps`).toBe(expected.expectedDps);
    }
  });

  it("matches reference outputs with alternate xinfas", () => {
    const ALT_XINFA_CASES = [
      { classId: "鸣金虹", xinfas: ["易水歌", "无名心法", "威猛歌", "断石之构"], damage: 2553342, rate: 21.31, excelRate: 21.3, expectedDps: 23863 },
      { classId: "鸣金影", xinfas: ["易水歌", "剑气纵横", "逐狼心经", "移经易武"], damage: 1846915, rate: 21.37, excelRate: 21.37, expectedDps: 24284 },
      { classId: "破竹尘", xinfas: ["易水歌", "千营一呼", "绳舟行木", "大唐歌"], damage: 2456146, rate: 22.07, excelRate: 22.08, expectedDps: 25243 },
      { classId: "破竹鸢", xinfas: ["易水歌", "扶摇直上", "擒天势", "三穷致知"], damage: 1861791, rate: 22.99, excelRate: 22.98, expectedDps: 24211 },
      { classId: "裂石威", xinfas: ["易水歌", "山河绝韵", "穿喉决", "断石之构"], damage: 2785795, rate: 24.26, excelRate: 24.26, expectedDps: 25914 },
      { classId: "裂石钧", xinfas: ["易水歌", "霜天白夜", "孤忠不辞", "断石之构"], damage: 2469167, rate: 28.48, excelRate: 28.48, expectedDps: 33367 },
      { classId: "牵丝玉", xinfas: ["易水歌", "花上月令", "纵地摘星", "春雷篇"], damage: 1924730, rate: 22.18, excelRate: 22.18, expectedDps: 25325 },
      { classId: "牵丝翊", xinfas: ["花上月令", "春雷篇", "纵地摘星", "断石之构"], damage: 1678292, rate: 16.71, excelRate: 16.72, expectedDps: 15569 },
    ];

    for (const expected of ALT_XINFA_CASES) {
      const setId = gameData.defaultSets[expected.classId] ?? "";
      const armoryType = ["鸣金", "裂石", "牵丝", "破竹"].includes(expected.classId.substring(0, 2))
        ? expected.classId.substring(0, 2) : "通用";
      const stats = calculateTotal({}, expected.classId, "", expected.xinfas, setId, false, false, undefined, armoryType, gameData);
      const result = calculateGraduationRate(stats, expected.classId, expected.xinfas, setId, gameData);

      expect(Math.round(result.details.playerDps), `${expected.classId} alt xinfas damage`).toBe(expected.damage);
      expect(result.graduationRate, `${expected.classId} alt xinfas graduation rate`).toBe(expected.rate);
      expect(result.excelRate, `${expected.classId} alt xinfas excel rate`).toBe(expected.excelRate);
      expect(result.expectedDps, `${expected.classId} alt xinfas expected dps`).toBe(expected.expectedDps);
    }
  });

  it("caps direct crit and direct intent rates to workbook limits", () => {
    const data: GameData = {
      ...gameData,
      seasonStats: {
        ...gameData.seasonStats,
        "BOSS防御": 0,
        "固伤加成": 0,
        "普通外功抗性": 0,
        "普通属性抗性": 0,
        "食物小外加成": 0,
        "食物大外加成": 0,
      },
      rotations: {
        TestClass: {
          rotation: [
            {
              name: "direct rate cap",
              count: 1,
              isDingyin: false,
              generalBonus: 0,
              included: false,
              yishui: 0,
              tiaozhan: 1,
            },
          ],
          skillDatabase: {
            "direct rate cap": {
              outerRatio: 1,
              fixed: 0,
              eleRatio: 0,
              exMinATK: 0,
              exMaxATK: 0,
              exATK: 0,
              exCrit: 0,
              exCritDmg: 0,
              exIntent: 0,
              exIntentDmg: 0,
              exDmg: 0,
              exPen: 0,
              isCharge: 0,
              type: "武器",
              weaponType: "N/A",
              element: "无",
              special: "",
              force: "",
            },
          },
          baseline: 100,
          baseline2: 0,
          useTime: 1,
          author: "test",
          version: "test",
          updateTime: "test",
        },
      },
    };

    const result = calculateGraduationRate(
      {
        "最小外功攻击": 100,
        "最大外功攻击": 100,
        "实际精准率": 100,
        "实际会心率": 0,
        "实际会意率": 0,
        "直接会心率": 50,
        "直接会意率": 50,
        "会心伤害加成": 100,
        "会意伤害加成": 100,
      },
      "TestClass",
      [],
      "",
      data,
    );

    expect(result.details.playerDps).toBe(132);
  });

  it("equipment stats accumulate correctly with gold weapon", () => {
    const goldWeapon = {
      id: "test-weapon",
      name: "TestWeapon",
      slotId: "1",
      isChengyin: false,
      isPurple: false,
      mainStat: { type: "最大外功攻击", value: 50 },
      subStats: [
        { type: "会心率", value: 5.5 },
        { type: "精准率", value: 3.2 },
      ],
      dingyinStat: { type: "外功穿透", value: 8 },
    };

    const xinfas = gameData.xinfaRules["破竹尘"]?.default ?? [];
    const setId = gameData.defaultSets["破竹尘"] ?? "";

    const statsWithout = calculateTotal({}, "破竹尘", "", xinfas, setId, false, false, undefined, "破竹", gameData);
    const statsWith = calculateTotal(
      { weapon1: goldWeapon as any },
      "破竹尘", "", xinfas, setId, false, false, undefined, "破竹", gameData,
    );

    const goldMinOuter = Number(gameData.seasonStats["金装武器最小外功"]);
    const goldMaxOuter = Number(gameData.seasonStats["金装武器最大外功"]);

    expect(statsWith["最小外功攻击"], "weapon adds min outer ATK").toBeCloseTo(
      statsWithout["最小外功攻击"] + goldMinOuter, 2,
    );
    expect(statsWith["最大外功攻击"], "weapon adds max outer ATK + main stat").toBeCloseTo(
      statsWithout["最大外功攻击"] + goldMaxOuter + 50, 2,
    );
    expect(statsWith["外功穿透"], "weapon adds dingyin pen").toBeCloseTo(
      statsWithout["外功穿透"] + 8, 4,
    );
  });

  it("chengyin equipment applies 0.94 multiplier to max values", () => {
    const chengyinPiece = {
      id: "test-chengyin",
      name: "ChengyinHead",
      slotId: "2",
      isChengyin: true,
      isPurple: false,
      mainStat: { type: "最大外功攻击", value: 0 },
      subStats: [{ type: "会心率", value: 10 }],
      dingyinStat: { type: "", value: 0 },
    };

    const xinfas = gameData.xinfaRules["破竹尘"]?.default ?? [];
    const setId = gameData.defaultSets["破竹尘"] ?? "";

    const statsWithout = calculateTotal({}, "破竹尘", "", xinfas, setId, false, false, undefined, "破竹", gameData);
    const statsWith = calculateTotal(
      { head: chengyinPiece as any },
      "破竹尘", "", xinfas, setId, false, false, undefined, "破竹", gameData,
    );

    const maxCrit = gameData.maxValues["会心率"];
    const expectedIncrease = 0.94 * maxCrit;
    expect(statsWith["实际会心率"] - statsWithout["实际会心率"], "chengyin applies 0.94 * max").toBeCloseTo(
      expectedIncrease / Number(gameData.seasonStats["赛季抗性"]), 2,
    );
  });

  it("bow type applies correct stat bonuses", () => {
    const xinfas = gameData.xinfaRules["裂石威"]?.default ?? [];
    const setId = gameData.defaultSets["裂石威"] ?? "";

    const noBow = calculateTotal({}, "裂石威", "", xinfas, setId, false, false, undefined, "裂石", gameData);
    const precBow = calculateTotal({}, "裂石威", "precision", xinfas, setId, false, false, undefined, "裂石", gameData);
    const critBow = calculateTotal({}, "裂石威", "crit", xinfas, setId, false, false, undefined, "裂石", gameData);
    const intentBow = calculateTotal({}, "裂石威", "intent", xinfas, setId, false, false, undefined, "裂石", gameData);

    const precBonus = Number(gameData.seasonStats["精准弓加成"]);
    const critBonus = Number(gameData.seasonStats["会心弓加成"]);
    const intentBonus = Number(gameData.seasonStats["会意弓加成"]);

    expect(precBow["实际精准率"] - noBow["实际精准率"], "precision bow").toBeCloseTo(
      precBonus / Number(gameData.seasonStats["赛季抗性"]), 2,
    );
    expect(critBow["实际会心率"] - noBow["实际会心率"], "crit bow").toBeCloseTo(
      critBonus / Number(gameData.seasonStats["赛季抗性"]), 2,
    );
    expect(intentBow["实际会意率"] - noBow["实际会意率"], "intent bow").toBeCloseTo(
      intentBonus / Number(gameData.seasonStats["赛季抗性"]), 2,
    );
  });

  it("graduation rate formula produces reasonable DPS for Excel-level stats", () => {
    const EXCEL_STAT_CASES = [
      {
        classId: "裂石钧", setId: "断岳",
        stats: {
          "最小外功攻击": 3417.8, "最大外功攻击": 2543.3,
          "外功穿透": 58.4, "外功伤害加成": 0,
          "最小裂石攻击": 628.3, "最大裂石攻击": 1257.7,
          "裂石穿透": 35.6, "裂石伤害加成": 14.8,
          "最小无相攻击": 66, "最大无相攻击": 185.6, "无相穿透": 0,
          "实际精准率": 83.7, "实际会心率": 74.9, "实际会意率": 9.86,
          "会心伤害加成": 64, "会意伤害加成": 35,
          "直接会心率": 9.2, "直接会意率": 0,
          "固伤加成": 0.225,
          "对首领单位增伤": 8.8,
          "全武学增效": 8.4, "全武学增伤": 8.4,
          "陌刀武学增效": 8.6, "横刀武学增效": 0,
          "指定武学技能增伤": 0,
        },
        xinfas: ["易水歌", "霜天白夜", "断石之构", "孤忠不辞"],
        excelTotalDmg: 8670672,
      },
      {
        classId: "破竹鸢", setId: "撼天",
        stats: {
          "最小外功攻击": 2028.7, "最大外功攻击": 4782.3,
          "外功穿透": 58.4, "外功伤害加成": 2.5,
          "最小破竹攻击": 431, "最大破竹攻击": 863,
          "破竹穿透": 29, "破竹伤害加成": 14.5,
          "最小无相攻击": 66, "最大无相攻击": 66, "无相穿透": 0,
          "实际精准率": 98.81, "实际会心率": 80, "实际会意率": 9.86,
          "会心伤害加成": 64, "会意伤害加成": 35,
          "直接会心率": 9.2, "直接会意率": 0,
          "固伤加成": 0.225,
          "对首领单位增伤": 8.8,
          "全武学增效": 8.4, "全武学增伤": 8.4,
          "拳甲武学增效": 8.6, "绳标武学增效": 0,
          "指定武学技能增伤": 0,
        },
        xinfas: ["易水歌", "扶摇直上", "擒天势", "所恨年年"],
        excelTotalDmg: 8099598,
      },
    ];

    for (const tc of EXCEL_STAT_CASES) {
      const result = calculateGraduationRate(tc.stats as unknown as StatSheet, tc.classId, tc.xinfas, tc.setId, gameData);
      expect(result.details.playerDps, `${tc.classId} DPS should be positive`).toBeGreaterThan(0);
      expect(result.expectedDps, `${tc.classId} expectedDps should be positive`).toBeGreaterThan(0);
    }
  });

  it("calculateTotal stats match spongem reference for all default loadouts", () => {
    const SPONGEM_STAT_REFS = [
      { classId: "鸣金虹", minATK: 1001.04, maxATK: 2123.1523287671234, precision: 83, crit: 19.010232558139535, intent: 13.43311882765212, critDmg: 50, intentDmg: 40.2, directCrit: 4.6, directIntent: 2.3 },
      { classId: "鸣金影", minATK: 1030.3733333333334, maxATK: 2075.81899543379, precision: 83, crit: 19.010232558139535, intent: 16.270328129977703, critDmg: 50, intentDmg: 40.2, directCrit: 4.6, directIntent: 2.3 },
      { classId: "破竹尘", minATK: 1253.6723287671232, maxATK: 1860.72, precision: 87.18604651162791, crit: 27.406154826377826, intent: 9.505116279069767, critDmg: 50, intentDmg: 35, directCrit: 4.6, directIntent: 0 },
      { classId: "破竹风", minATK: 1147.6723287671232, maxATK: 1938.92, precision: 83, crit: 27.406154826377826, intent: 12.34232558139535, critDmg: 57.9, intentDmg: 35, directCrit: 4.6, directIntent: 0 },
      { classId: "破竹鸢", minATK: 1263.4723287671231, maxATK: 1860.72, precision: 87.18604651162791, crit: 26.848015291494107, intent: 9.505116279069767, critDmg: 54, intentDmg: 35, directCrit: 13.299999999999999, directIntent: 0 },
      { classId: "裂石威", minATK: 1001.04, maxATK: 1860.72, precision: 88.02325581395348, crit: 27.40615482637783, intent: 9.505116279069767, critDmg: 54.4, intentDmg: 35, directCrit: 4.6, directIntent: 0 },
      { classId: "裂石钧", minATK: 1157.4723287671231, maxATK: 1860.72, precision: 88.02325581395348, crit: 26.848015291494107, intent: 9.505116279069767, critDmg: 54, intentDmg: 35, directCrit: 9.2, directIntent: 0 },
      { classId: "裂石钧（纯唐）", minATK: 1351.4723287671231, maxATK: 1860.72, precision: 83, crit: 22.150340872889455, intent: 9.505116279069767, critDmg: 50, intentDmg: 35, directCrit: 9.2, directIntent: 0 },
      { classId: "牵丝霖", minATK: 1147.6723287671232, maxATK: 1860.72, precision: 88.02325581395348, crit: 27.406154826377826, intent: 9.505116279069767, critDmg: 50, intentDmg: 35, directCrit: 9.2, directIntent: 0 },
      { classId: "牵丝玉", minATK: 1089.0056621004567, maxATK: 1919.3866666666668, precision: 87.18604651162791, crit: 27.406154826377826, intent: 12.34232558139535, critDmg: 54.4, intentDmg: 35, directCrit: 8.7, directIntent: 0 },
    ];

    for (const ref of SPONGEM_STAT_REFS) {
      const xinfaLoadout = gameData.xinfaRules[ref.classId]?.default ?? [];
      const setId = gameData.defaultSets[ref.classId] ?? "";
      const stats = calculateTotal({}, ref.classId, "", xinfaLoadout, setId, false, false, undefined, getArmoryType(ref.classId), gameData);

      expect(stats["最小外功攻击"], `${ref.classId} minATK`).toBeCloseTo(ref.minATK, 4);
      expect(stats["最大外功攻击"], `${ref.classId} maxATK`).toBeCloseTo(ref.maxATK, 4);
      expect(stats["实际精准率"], `${ref.classId} precision`).toBeCloseTo(ref.precision, 4);
      expect(stats["实际会心率"], `${ref.classId} crit`).toBeCloseTo(ref.crit, 4);
      expect(stats["实际会意率"], `${ref.classId} intent`).toBeCloseTo(ref.intent, 4);
      expect(stats["会心伤害加成"], `${ref.classId} critDmg`).toBeCloseTo(ref.critDmg, 4);
      expect(stats["会意伤害加成"], `${ref.classId} intentDmg`).toBeCloseTo(ref.intentDmg, 4);
      expect(stats["直接会心率"], `${ref.classId} directCrit`).toBeCloseTo(ref.directCrit, 4);
      expect(stats["直接会意率"], `${ref.classId} directIntent`).toBeCloseTo(ref.directIntent, 4);
    }
  });

  it("capRates returns correct capped stat values", () => {
    const xinfas = gameData.xinfaRules["破竹尘"]?.default ?? [];
    const setId = gameData.defaultSets["破竹尘"] ?? "";
    const stats = calculateTotal({}, "破竹尘", "", xinfas, setId, false, false, undefined, "破竹", gameData);
    const capped = capRates(stats);

    expect(capped.actualPrecision, "actualPrecision").toBeCloseTo(stats["实际精准率"], 4);
    expect(capped.actualCrit, "actualCrit").toBeCloseTo(stats["实际会心率"], 4);
    expect(capped.actualIntent, "actualIntent").toBeCloseTo(stats["实际会意率"], 4);
    expect(capped.precisionOverflow, "precisionOverflow").toBe(stats["精准率溢出"] ?? 0);
    expect(capped.critOverflow, "critOverflow").toBe(stats["会心率溢出"] ?? 0);
    expect(capped.intentOverflow, "intentOverflow").toBe(stats["会意率溢出"] ?? 0);
  });
});
