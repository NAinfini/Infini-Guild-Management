import {
  DEFAULT_GAME_RULES,
  GUILD_WAR_RESULT_DEFINITIONS,
  WAR_RESULTS,
  type WarResult,
} from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { FlagIcon } from "@portal/components/icons";
import { MetricGridInput } from "@portal/components/shared/MetricGridInput";
import { SectionHeader } from "@portal/components/shared/SectionHeader";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getGuildWarMemberStatLabel,
  getGuildWarResultLabel,
  getGuildWarTeamStatLabel,
} from "@portal/utils/game-rules";

export type ConcludeWarMember = {
  userId: string;
  display_name: string;
  teamName: string;
  stats: Record<string, number>;
};

export type ConcludeWarInfo = {
  enemyName: string;
  result: WarResult | "";
  durationMinutes: number | null;
  ownStats: Record<string, number | null>;
  enemyStats: Record<string, number | null>;
};

export type ConcludeWarSubmitData = {
  warInfo: Omit<ConcludeWarInfo, "result"> & { result: WarResult };
  memberStats: Array<{
    user_id: string;
    stats: Record<string, number>;
  }>;
};

const EMPTY_RESULT_VALUE = "__unset__";

type ConcludeWarModalProps = {
  opened: boolean;
  onClose: () => void;
  onSubmit: (data: ConcludeWarSubmitData) => void;
  members: ConcludeWarMember[];
  pending: boolean;
  warName: string;
};

function createInitialWarInfo(teamStatKeys: string[]): ConcludeWarInfo {
  return {
    enemyName: "",
    result: "",
    durationMinutes: null,
    ownStats: Object.fromEntries(teamStatKeys.map((key) => [key, null])),
    enemyStats: Object.fromEntries(teamStatKeys.map((key) => [key, null])),
  };
}

function createInitialMemberStats(
  members: ConcludeWarMember[],
): Map<string, Record<string, number>> {
  return new Map(members.map((member) => [member.userId, { ...member.stats }]));
}

export function ConcludeWarModal({
  opened,
  onClose,
  onSubmit,
  members,
  pending,
  warName,
}: ConcludeWarModalProps) {
  const { t } = useTranslation("guild-war");
  const enemyNameId = useId();
  const resultId = useId();
  const durationId = useId();
  const gameRules = DEFAULT_GAME_RULES;
  const warRules = gameRules.guild_war;
  const memberStatFields = warRules.member_stats;
  const teamObjectiveFields = warRules.team_stats;

  const [warInfo, setWarInfo] = useState<ConcludeWarInfo>(() => createInitialWarInfo(teamObjectiveFields.map((field) => field.key)));
  const [memberStatsMap, setMemberStatsMap] = useState<Map<string, Record<string, number>>>(
    () => createInitialMemberStats(members),
  );

  useEffect(() => {
    setMemberStatsMap(createInitialMemberStats(members));
    if (!opened) {
      setWarInfo(createInitialWarInfo(teamObjectiveFields.map((field) => field.key)));
    }
  }, [members, opened, teamObjectiveFields]);

  const handleClose = useCallback(() => {
    if (!pending) {
      onClose();
    }
  }, [onClose, pending]);

  const updateWarInfoField = useCallback(
    <K extends keyof ConcludeWarInfo>(key: K, value: ConcludeWarInfo[K]) => {
      setWarInfo((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateOwnStat = useCallback((key: string, value: number | null) => {
    setWarInfo((prev) => ({ ...prev, ownStats: { ...prev.ownStats, [key]: value } }));
  }, []);

  const updateEnemyStat = useCallback((key: string, value: number | null) => {
    setWarInfo((prev) => ({ ...prev, enemyStats: { ...prev.enemyStats, [key]: value } }));
  }, []);

  const updateMemberStat = useCallback(
    (userId: string, field: string, value: number) => {
      setMemberStatsMap((prev) => {
        const next = new Map(prev);
        const current = next.get(userId) ?? {};
        next.set(userId, { ...current, [field]: value });
        return next;
      });
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!warInfo.result) return;
    const memberStats = members.map((m) => {
      const current = memberStatsMap.get(m.userId) ?? {};
      const stats = Object.fromEntries(memberStatFields.map((field) => [field.key, current[field.key] ?? 0]));
      return { user_id: m.userId, stats };
    });
    onSubmit({ warInfo: { ...warInfo, result: warInfo.result }, memberStats });
  }, [memberStatFields, members, memberStatsMap, onSubmit, warInfo]);

  const resultOptions = GUILD_WAR_RESULT_DEFINITIONS.map((definition) => ({
    value: definition.id,
    label: getGuildWarResultLabel(definition.id),
  }));

  return (
    <Dialog
      open={opened}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) return;
        if (pending || details.reason === "outside-press") {
          details.cancel();
          return;
        }
        handleClose();
      }}
    >
      <DialogContent
        className="conclude-war-modal sm:max-w-[min(960px,calc(100vw-2rem))]"
        closeLabel={t("common:action.close")}
        closeButtonDisabled={pending}
      >
        <DialogHeader>
          <DialogTitle>{t("conclude.title", { warName })}</DialogTitle>
        </DialogHeader>
        <div className="conclude-war-modal__body conclude-war-modal__layout">
          <div className="conclude-war-modal__content-scroll">
          <div className="conclude-war-modal__content">
            <section className="conclude-war-modal__section">
              <SectionHeader title={t("conclude.section.warInfo")} className="section-header--flush" />
              <div className="conclude-war-modal__war-fields">
                <div className="conclude-war-modal__field conclude-war-modal__enemy">
                  <Label htmlFor={enemyNameId}>{t("conclude.field.enemyName")}</Label>
                  <Input
                    id={enemyNameId}
                    value={warInfo.enemyName}
                    onChange={(event) => updateWarInfoField("enemyName", event.currentTarget.value)}
                  />
                </div>
                <div className="conclude-war-modal__field">
                  <Label htmlFor={resultId}>{t("conclude.field.result")}</Label>
                  <Select
                    items={[{ value: EMPTY_RESULT_VALUE, label: t("conclude.field.result") }, ...resultOptions]}
                    value={warInfo.result || EMPTY_RESULT_VALUE}
                    onValueChange={(value) => updateWarInfoField(
                      "result",
                      value && WAR_RESULTS.includes(value as WarResult) ? value as WarResult : "",
                    )}
                  >
                    <SelectTrigger id={resultId} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value={EMPTY_RESULT_VALUE}>{t("conclude.field.result")}</SelectItem>
                      {resultOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="conclude-war-modal__field">
                  <Label htmlFor={durationId}>{t("conclude.field.duration")}</Label>
                  <Input
                    id={durationId}
                    type="number"
                    value={warInfo.durationMinutes ?? ""}
                    onChange={(event) => updateWarInfoField(
                      "durationMinutes",
                      event.currentTarget.value === "" ? null : Number(event.currentTarget.value),
                    )}
                    min={0}
                  />
                </div>
              </div>

              {teamObjectiveFields.length > 0 ? (
                <table
                  aria-label={t("conclude.section.objectives")}
                  className="conclude-war-modal__objective-ledger"
                >
                  <thead>
                    <tr>
                      <th scope="col">{t("conclude.section.objectives")}</th>
                      <th scope="col">{t("history.compare.us")}</th>
                      <th scope="col">{t("history.compare.enemy")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamObjectiveFields.map((objective, rowIndex) => {
                      const objectiveLabel = getGuildWarTeamStatLabel(objective.key);
                      return (
                        <tr key={objective.key}>
                          <th scope="row">{objectiveLabel}</th>
                          <td>
                            <MetricGridInput
                              className="conclude-war-modal__objective-input"
                              aria-label={t("conclude.aria.objectiveMetric", {
                                metric: t(`conclude.field.own_${objective.key}`, { defaultValue: `Own ${objective.key}` }),
                              })}
                              gridId="conclude-war-objectives"
                              rowIndex={rowIndex}
                              columnIndex={0}
                              rowCount={teamObjectiveFields.length}
                              columnCount={2}
                              value={warInfo.ownStats[objective.key] ?? ""}
                              onValueChange={(value) => updateOwnStat(objective.key, value)}
                              min={0}
                            />
                          </td>
                          <td>
                            <MetricGridInput
                              className="conclude-war-modal__objective-input"
                              aria-label={t("conclude.aria.objectiveMetric", {
                                metric: t(`conclude.field.enemy_${objective.key}`, { defaultValue: `Enemy ${objective.key}` }),
                              })}
                              gridId="conclude-war-objectives"
                              rowIndex={rowIndex}
                              columnIndex={1}
                              rowCount={teamObjectiveFields.length}
                              columnCount={2}
                              value={warInfo.enemyStats[objective.key] ?? ""}
                              onValueChange={(value) => updateEnemyStat(objective.key, value)}
                              min={0}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </section>

            {members.length > 0 ? (
              <section className="conclude-war-modal__section">
                <div className="conclude-war-modal__section-heading">
                  <SectionHeader title={t("conclude.section.memberStats")} className="section-header--flush" />
                  <p className="text-xs text-muted-foreground">
                    {t("conclude.keyboardHint")}
                  </p>
                </div>
                <div
                  style={{ maxHeight: Math.min(members.length * 42 + 42, 252) }}
                  className="conclude-war-modal__table-scroll"
                >
                  <table className="conclude-war-modal__table">
                    <thead>
                      <tr>
                        <th className="conclude-war-modal__sticky-col" scope="col">
                          {t("conclude.col.member")}
                        </th>
                        {memberStatFields.map((field) => (
                          <th key={field.key} className="conclude-war-modal__metric-heading" scope="col">
                            {getGuildWarMemberStatLabel(field.key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member, rowIndex) => {
                        const stats = memberStatsMap.get(member.userId) ?? {};
                        return (
                          <tr key={member.userId}>
                            <th className="conclude-war-modal__sticky-col conclude-war-modal__sticky-col--cell" scope="row">
                              <span className="conclude-war-modal__member-name">{member.display_name}</span>
                              <span className="conclude-war-modal__team-name">{member.teamName}</span>
                            </th>
                            {memberStatFields.map((field, columnIndex) => (
                              <td key={field.key} className="conclude-war-modal__metric-cell">
                                <MetricGridInput
                                  className="conclude-war-modal__metric-input"
                                  aria-label={t("conclude.aria.memberMetric", {
                                    member: member.display_name,
                                    metric: getGuildWarMemberStatLabel(field.key),
                                  })}
                                  gridId="conclude-war-member-stats"
                                  rowIndex={rowIndex}
                                  columnIndex={columnIndex}
                                  rowCount={members.length}
                                  columnCount={memberStatFields.length}
                                  value={stats[field.key] ?? 0}
                                  onValueChange={(value) => updateMemberStat(member.userId, field.key, value ?? 0)}
                                  min={0}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
          </div>

        <div className="conclude-war-modal__footer">
          <Button autoFocus variant="outline" onClick={handleClose} disabled={pending}>
            {t("common:action.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            loading={pending}
            disabled={!warInfo.result}
          >
            <FlagIcon size={16} data-icon="inline-start" />
            {t("conclude.submit")}
          </Button>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
