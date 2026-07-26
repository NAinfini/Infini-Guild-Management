import type { GameDefinition } from "../types";

export const yanYunGame: GameDefinition = {
  id: "yan-yun",
  name: "燕云十六声",

  classes: [
    { id: "鸣金虹", label: "鸣金虹", colorGroup: "blue", role: "dps" },
    { id: "鸣金影", label: "鸣金影", colorGroup: "blue", role: "dps" },
    { id: "牵丝玉", label: "牵丝玉", colorGroup: "green", role: "dps" },
    { id: "牵丝霖", label: "牵丝霖", colorGroup: "green", role: "healer" },
    { id: "牵丝翊", label: "牵丝翊", colorGroup: "green", role: "dps" },
    { id: "破竹风", label: "破竹风", colorGroup: "purple", role: "dps" },
    { id: "破竹尘", label: "破竹尘", colorGroup: "purple", role: "dps" },
    { id: "破竹鸢", label: "破竹鸢", colorGroup: "purple", role: "dps" },
    { id: "裂石威", label: "裂石威", colorGroup: "dark-red", role: "tank" },
    { id: "裂石钧", label: "裂石钧", colorGroup: "dark-red", role: "dps" },
  ],

  classColorMapping: {
    blue: "blue",
    green: "teal",
    purple: "violet",
    "dark-red": "red",
  },

  roles: [
    { id: "healer", label: "治疗", color: "#10b981", avatarColor: "green", icon: "IconHeartbeat" },
    { id: "tank", label: "防御", color: "#d97706", avatarColor: "yellow", icon: "IconShield" },
    { id: "dps", label: "输出", color: "#3b82f6", avatarColor: "blue", icon: "IconSword" },
  ],
  defaultRole: "dps",

  profileStats: [
    { key: "power", label: "profile.field.power", type: "number", sortable: true },
  ],

  war: {
    enabled: true,
    featureLabel: "nav.guild-war",
    resultOptions: ["win", "loss", "draw"],
    teamObjectives: [
      { key: "kills", label: "guild-war:history.kills", hasBothSides: true },
      { key: "towers", label: "guild-war:history.towers", hasBothSides: true },
      { key: "base_hp", label: "guild-war:history.baseHp", hasBothSides: true },
      { key: "credits", label: "guild-war:history.credits", hasBothSides: true },
      { key: "distance", label: "guild-war:history.distance", hasBothSides: true },
    ],
    memberStats: [
      { key: "kills", label: "guild-war:analytics.metric.kills", aggregations: ["total", "average", "best", "median"] },
      { key: "deaths", label: "guild-war:analytics.metric.deaths", aggregations: ["total", "average", "best", "median"], lowerIsBetter: true },
      { key: "assists", label: "guild-war:analytics.metric.assists", aggregations: ["total", "average", "best", "median"] },
      { key: "damage", label: "guild-war:analytics.metric.damage", aggregations: ["total", "average", "best", "median"] },
      { key: "healing", label: "guild-war:analytics.metric.healing", aggregations: ["total", "average", "best", "median"] },
      { key: "building_damage", label: "guild-war:analytics.metric.buildingDamage", aggregations: ["total", "average", "best", "median"] },
      { key: "credits", label: "guild-war:analytics.metric.credits", aggregations: ["total", "average", "best", "median"] },
      { key: "damage_taken", label: "guild-war:analytics.metric.damageTaken", aggregations: ["total", "average", "best", "median"], lowerIsBetter: true },
    ],
    computedStats: [
      {
        key: "kda",
        label: "guild-war:analytics.metric.kda",
        compute: (stats) => {
          const kills = stats.kills ?? 0;
          const assists = stats.assists ?? 0;
          const deaths = (stats.deaths ?? 0) > 0 ? stats.deaths! : 1;
          return Number(((kills + assists) / deaths).toFixed(2));
        },
      },
    ],
    mvpCategories: ["damage", "healing", "damage_taken", "building_damage"],
    defaultTeamNames: ["Alpha", "Bravo"],
    captainRoleTag: "Captain",
    modifierWeights: {
      kda: 0.30,
      towers: 0.10,
      credits: 0.30,
      distance: 0.15,
      basehp: 0.15,
    },
  },

  eventTypes: [
    { id: "weekly_mission", label: "events:type.weeklyMission", icon: "TargetOutlined", color: "portal-gold" },
    { id: "guild_war", label: "events:type.guildWar", icon: "SwordsOutlined", color: "red" },
    { id: "social", label: "events:type.social", icon: "TeamOutlined", color: "portal-bronze" },
    { id: "poll", label: "events:type.poll", icon: "ChartBarOutlined", color: "teal" },
    { id: "raffle", label: "events:type.raffle", icon: "GiftOutlined", color: "pink" },
    { id: "other", label: "events:type.other", icon: "CalendarEventOutlined", color: "gray" },
  ],
};
