import type { EventClassQuota } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { ActionIcon, Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import { PlusIcon, TrashIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { useTranslation } from "react-i18next";

const MAX_QUOTAS = LIMITS.content.eventClassQuotas.max;

/*
 * 职业配额编辑器，活动表单和周期模板表单共用。
 *
 * 配额跟 capacity 是两件事，这里不做任何跟 capacity 的联动校验（见
 * apps/shared/schemas/event.ts 里同一条注释）：配额是 capacity 的子集，管理员完全
 * 可以先配好职业需求再决定放多少人。
 *
 * 一个职业只能出现一次——服务端会因为重复项直接拒收整个请求，所以下拉里已经用掉的
 * 职业要摘掉，不能让人先配出一份必然保存失败的表单。
 */
type ClassQuotaEditorProps = {
  value: EventClassQuota[];
  onChange: (next: EventClassQuota[]) => void;
  disabled?: boolean;
};

export function ClassQuotaEditor({ value, onChange, disabled = false }: ClassQuotaEditorProps) {
  const { t } = useTranslation("events");
  const catalog = useClassCatalogStore((state) => state.items);

  const used = new Set(value.map((quota) => quota.class_id));
  const unusedClasses = catalog.filter((item) => !used.has(item.id));
  const canAdd = !disabled && unusedClasses.length > 0 && value.length < MAX_QUOTAS;

  const replaceAt = (index: number, next: EventClassQuota) => {
    onChange(value.map((quota, position) => (position === index ? next : quota)));
  };

  return (
    <Stack gap={8}>
      <div>
        <Text size="sm" fw={500}>{t("quota.editor.label")}</Text>
        <Text size="xs" c="dimmed">{t("quota.editor.hint")}</Text>
      </div>

      {value.map((quota, index) => {
        const item = resolveClassCatalogItem(quota.class_id, catalog);
        /* 当前行自己的职业要留在选项里，否则这一行的 Select 会显示成空的。 */
        const options = [
          { value: quota.class_id, label: item.label },
          ...unusedClasses.map((entry) => ({ value: entry.id, label: entry.label })),
        ];
        return (
          <Group key={quota.class_id} gap={8} wrap="nowrap">
            <ClassIcon item={item} size={24} />
            <Select
              flex={1}
              aria-label={t("quota.editor.classLabel")}
              value={quota.class_id}
              data={options}
              disabled={disabled}
              allowDeselect={false}
              onChange={(next) => {
                if (next) {
                  replaceAt(index, { ...quota, class_id: next });
                }
              }}
            />
            <NumberInput
              w={96}
              aria-label={t("quota.editor.requiredLabel")}
              min={1}
              max={999}
              clampBehavior="strict"
              disabled={disabled}
              value={quota.required}
              onChange={(next) => {
                const parsed = typeof next === "number" ? next : Number.parseInt(next, 10);
                if (Number.isFinite(parsed) && parsed >= 1) {
                  replaceAt(index, { ...quota, required: Math.floor(parsed) });
                }
              }}
            />
            <ActionIcon
              variant="subtle"
              color="red"
              disabled={disabled}
              aria-label={t("quota.editor.remove", { label: item.label })}
              onClick={() => onChange(value.filter((_, position) => position !== index))}
            >
              <TrashIcon size={16} />
            </ActionIcon>
          </Group>
        );
      })}

      <Group gap={8}>
        <Button
          variant="light"
          size="xs"
          leftSection={<PlusIcon size={14} />}
          disabled={!canAdd}
          onClick={() => {
            const next = unusedClasses[0];
            if (next) {
              onChange([...value, { class_id: next.id, required: 1 }]);
            }
          }}
        >
          {t("quota.editor.add")}
        </Button>
        {value.length >= MAX_QUOTAS ? (
          <Text size="xs" c="dimmed">{t("quota.editor.maxReached", { max: MAX_QUOTAS })}</Text>
        ) : null}
      </Group>
    </Stack>
  );
}
