export interface ClassDef {
  id: string;
  label: string;
  colorGroup: string;
  role?: string;
}

export interface StatFieldDef {
  key: string;
  label: string;
  type: "number" | "string";
  sortable?: boolean;
}

export interface WarObjectiveDef {
  key: string;
  label: string;
  hasBothSides: boolean;
}

export interface WarMemberStatDef {
  key: string;
  label: string;
  aggregations: readonly ("total" | "average" | "best" | "median")[];
  lowerIsBetter?: boolean;
}

export interface ComputedStatDef {
  key: string;
  label: string;
  compute: (stats: Record<string, number>) => number;
  lowerIsBetter?: boolean;
}

export interface EventTypeDef {
  id: string;
  label: string;
  icon: string;
  color: string;
}

export interface RoleConfig {
  id: string;
  label: string;
  color: string;
  avatarColor: string;
  icon: string;
}

export interface WarConfig {
  enabled: boolean;
  featureLabel: string;
  resultOptions: readonly string[];
  teamObjectives: readonly WarObjectiveDef[];
  memberStats: readonly WarMemberStatDef[];
  computedStats?: readonly ComputedStatDef[];
  mvpCategories: readonly string[];
  defaultTeamNames: readonly string[];
  modifierWeights: Record<string, number>;
  captainRoleTag: string;
}

export interface GameDefinition {
  id: string;
  name: string;
  classes: readonly ClassDef[];
  classColorMapping: Record<string, string>;
  roles: readonly RoleConfig[];
  defaultRole: string;
  profileStats: readonly StatFieldDef[];
  war: WarConfig;
  eventTypes: readonly EventTypeDef[];
}
