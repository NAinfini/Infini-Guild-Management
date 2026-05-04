import {
  Button,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconFlag } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// --- Types ---

export type ConcludeWarMember = {
  userId: string;
  username: string;
  teamName: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  healing: number;
  buildingDamage: number;
  credits: number;
  damageTaken: number;
};

export type ConcludeWarInfo = {
  enemyName: string;
  result: "win" | "loss" | "draw" | "";
  durationMinutes: number | null;
  ownKills: number | null;
  ownTowers: number | null;
  ownBaseHp: number | null;
  ownCredits: number | null;
  ownDistance: number | null;
  enemyKills: number | null;
  enemyTowers: number | null;
  enemyBaseHp: number | null;
  enemyCredits: number | null;
  enemyDistance: number | null;
};

export type ConcludeWarSubmitData = {
  warInfo: ConcludeWarInfo;
  memberStats: Array<{
    user_id: string;
    stats: {
      kills?: number;
      deaths?: number;
      assists?: number;
      damage?: number;
      healing?: number;
      building_damage?: number;
      credits?: number;
      damage_taken?: number;
    };
  }>;
};

type ConcludeWarModalProps = {
  opened: boolean;
  onClose: () => void;
  onSubmit: (data: ConcludeWarSubmitData) => void;
  members: ConcludeWarMember[];
  pending: boolean;
  warName: string;
};

// --- Stat field definitions for extensibility ---

type MemberStatField = {
  key: keyof Omit<ConcludeWarMember, "userId" | "username" | "teamName">;
  apiKey: string;
};

const MEMBER_STAT_FIELDS: MemberStatField[] = [
  { key: "kills", apiKey: "kills" },
  { key: "deaths", apiKey: "deaths" },
  { key: "assists", apiKey: "assists" },
  { key: "damage", apiKey: "damage" },
  { key: "healing", apiKey: "healing" },
  { key: "buildingDamage", apiKey: "building_damage" },
  { key: "credits", apiKey: "credits" },
  { key: "damageTaken", apiKey: "damage_taken" },
];

// --- Component ---

export function ConcludeWarModal({
  opened,
  onClose,
  onSubmit,
  members,
  pending,
  warName,
}: ConcludeWarModalProps) {
  const { t } = useTranslation("guild-war");

  // War info state
  const [warInfo, setWarInfo] = useState<ConcludeWarInfo>({
    enemyName: "",
    result: "",
    durationMinutes: null,
    ownKills: null,
    ownTowers: null,
    ownBaseHp: null,
    ownCredits: null,
    ownDistance: null,
    enemyKills: null,
    enemyTowers: null,
    enemyBaseHp: null,
    enemyCredits: null,
    enemyDistance: null,
  });

  // Member stats state — keyed by userId
  const [memberStatsMap, setMemberStatsMap] = useState<
    Map<string, Record<string, number>>
  >(() => {
    const map = new Map<string, Record<string, number>>();
    for (const m of members) {
      map.set(m.userId, {
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        damage: m.damage,
        healing: m.healing,
        building_damage: m.buildingDamage,
        credits: m.credits,
        damage_taken: m.damageTaken,
      });
    }
    return map;
  });

  // Re-initialize member stats when members change (modal re-opened with new data)
  useEffect(() => {
    const map = new Map<string, Record<string, number>>();
    for (const m of members) {
      map.set(m.userId, {
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        damage: m.damage,
        healing: m.healing,
        building_damage: m.buildingDamage,
        credits: m.credits,
        damage_taken: m.damageTaken,
      });
    }
    setMemberStatsMap(map);
  }, [members]);

  const updateWarInfo = useCallback(
    <K extends keyof ConcludeWarInfo>(key: K, value: ConcludeWarInfo[K]) => {
      setWarInfo((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

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
    const memberStats = members.map((m) => {
      const stats = memberStatsMap.get(m.userId) ?? {};
      return { user_id: m.userId, stats };
    });
    onSubmit({ warInfo, memberStats });
  }, [members, memberStatsMap, onSubmit, warInfo]);

  const resultOptions = useMemo(
    () => [
      { value: "win", label: t("conclude.result.win") },
      { value: "loss", label: t("conclude.result.loss") },
      { value: "draw", label: t("conclude.result.draw") },
    ],
    [t],
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("conclude.title", { warName })}
      size="xl"
      centered
      closeOnClickOutside={false}
    >
      <Stack gap={16}>
        {/* Section 1: War-level info */}
        <Text size="sm" fw={600} tt="uppercase" c="dimmed">
          {t("conclude.section.warInfo")}
        </Text>
        <Group gap={10} wrap="wrap" grow>
          <TextInput
            label={t("conclude.field.enemyName")}
            value={warInfo.enemyName}
            onChange={(e) => updateWarInfo("enemyName", e.currentTarget.value)}
            style={{ flex: "1 1 180px" }}
          />
          <Select
            label={t("conclude.field.result")}
            data={resultOptions}
            value={warInfo.result || null}
            onChange={(v) => updateWarInfo("result", (v ?? "") as ConcludeWarInfo["result"])}
            clearable
            style={{ flex: "0 1 140px" }}
          />
          <NumberInput
            label={t("conclude.field.duration")}
            value={warInfo.durationMinutes ?? ""}
            onChange={(v) => updateWarInfo("durationMinutes", typeof v === "number" ? v : null)}
            min={0}
            hideControls
            suffix=" min"
            style={{ flex: "0 1 130px" }}
          />
        </Group>

        {/* Own vs Enemy stats */}
        <Group gap={10} wrap="wrap" grow>
          <NumberInput label={t("conclude.field.ownKills")} value={warInfo.ownKills ?? ""} onChange={(v) => updateWarInfo("ownKills", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
          <NumberInput label={t("conclude.field.enemyKills")} value={warInfo.enemyKills ?? ""} onChange={(v) => updateWarInfo("enemyKills", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
          <NumberInput label={t("conclude.field.ownTowers")} value={warInfo.ownTowers ?? ""} onChange={(v) => updateWarInfo("ownTowers", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
          <NumberInput label={t("conclude.field.enemyTowers")} value={warInfo.enemyTowers ?? ""} onChange={(v) => updateWarInfo("enemyTowers", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
        </Group>
        <Group gap={10} wrap="wrap" grow>
          <NumberInput label={t("conclude.field.ownBaseHp")} value={warInfo.ownBaseHp ?? ""} onChange={(v) => updateWarInfo("ownBaseHp", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
          <NumberInput label={t("conclude.field.enemyBaseHp")} value={warInfo.enemyBaseHp ?? ""} onChange={(v) => updateWarInfo("enemyBaseHp", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
          <NumberInput label={t("conclude.field.ownCredits")} value={warInfo.ownCredits ?? ""} onChange={(v) => updateWarInfo("ownCredits", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
          <NumberInput label={t("conclude.field.enemyCredits")} value={warInfo.enemyCredits ?? ""} onChange={(v) => updateWarInfo("enemyCredits", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
        </Group>
        <Group gap={10} wrap="wrap" grow>
          <NumberInput label={t("conclude.field.ownDistance")} value={warInfo.ownDistance ?? ""} onChange={(v) => updateWarInfo("ownDistance", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
          <NumberInput label={t("conclude.field.enemyDistance")} value={warInfo.enemyDistance ?? ""} onChange={(v) => updateWarInfo("enemyDistance", typeof v === "number" ? v : null)} min={0} hideControls style={{ flex: "1 1 100px" }} />
        </Group>

        {/* Section 2: Member stats table */}
        {members.length > 0 ? (
          <>
            <Text size="sm" fw={600} tt="uppercase" c="dimmed">
              {t("conclude.section.memberStats")}
            </Text>
            <ScrollArea h={Math.min(members.length * 48 + 48, 360)} type="auto">
              <Table striped highlightOnHover withTableBorder withColumnBorders style={{ fontSize: "0.8rem" }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ position: "sticky", left: 0, background: "var(--mantine-color-body)", zIndex: 1 }}>
                      {t("conclude.col.member")}
                    </Table.Th>
                    {MEMBER_STAT_FIELDS.map((f) => (
                      <Table.Th key={f.key} style={{ minWidth: 70, textAlign: "center" }}>
                        {t(`conclude.col.${f.key}`)}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {members.map((member) => {
                    const stats = memberStatsMap.get(member.userId) ?? {};
                    return (
                      <Table.Tr key={member.userId}>
                        <Table.Td style={{ position: "sticky", left: 0, background: "var(--mantine-color-body)", zIndex: 1, whiteSpace: "nowrap" }}>
                          <Text size="xs" fw={500} lineClamp={1}>{member.username}</Text>
                          <Text size="xs" c="dimmed">{member.teamName}</Text>
                        </Table.Td>
                        {MEMBER_STAT_FIELDS.map((f) => (
                          <Table.Td key={f.key} style={{ padding: "2px 4px" }}>
                            <NumberInput
                              size="xs"
                              variant="unstyled"
                              hideControls
                              value={stats[f.apiKey] ?? 0}
                              onChange={(v) => updateMemberStat(member.userId, f.apiKey, typeof v === "number" ? v : 0)}
                              min={0}
                              styles={{ input: { textAlign: "center", padding: "2px 4px" } }}
                            />
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        ) : null}

        {/* Actions */}
        <Group justify="flex-end" gap={8}>
          <Button variant="default" onClick={onClose} disabled={pending}>
            {t("common:action.cancel")}
          </Button>
          <Button
            color="red"
            leftSection={<IconFlag size={16} />}
            onClick={handleSubmit}
            loading={pending}
          >
            {t("conclude.submit")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
