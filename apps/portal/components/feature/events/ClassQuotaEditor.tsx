import type { ClassTag, EventClassQuotaInput } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { ActionIcon, Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import { PlusIcon, TrashIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { useClassTagStore } from "@portal/stores/class-tag";
import { useTranslation } from "react-i18next";

const MAX_QUOTAS = LIMITS.content.eventClassQuotas.max;

/*
 * 职业配额编辑器，活动表单和周期模板表单共用。
 *
 * 一格配额指的是一个职业标签，而不是单个职业——「要 2 个治疗，牵丝霖破竹风都行」。
 * 只要一个职业的写法就是一个只装了它自己的标签，在后台职业页建。
 *
 * 配额跟 capacity 是两件事，这里不做任何跟 capacity 的联动校验（见
 * apps/shared/schemas/event.ts 里同一条注释）：配额是 capacity 的子集，管理员完全
 * 可以先配好需求再决定放多少人。
 *
 * 同一个标签只能出现一次——服务端会因为重复项直接拒收整个请求，所以下拉里已经用掉的
 * 标签要摘掉，不能让人先配出一份必然保存失败的表单。不同标签之间重叠是允许的。
 */
type ClassQuotaEditorProps = {
  value: EventClassQuotaInput[];
  onChange: (next: EventClassQuotaInput[]) => void;
  disabled?: boolean;
};

export function ClassQuotaEditor({ value, onChange, disabled = false }: ClassQuotaEditorProps) {
  const { t } = useTranslation("events");
  const catalog = useClassCatalogStore((state) => state.items);
  const tags = useClassTagStore((state) => state.tags);

  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const used = new Set(value.map((quota) => quota.tag_id));
  const unusedTags = tags.filter((tag) => !used.has(tag.id));
  const canAdd = !disabled && unusedTags.length > 0 && value.length < MAX_QUOTAS;

  const replaceAt = (index: number, next: EventClassQuotaInput) => {
    onChange(value.map((quota, position) => (position === index ? next : quota)));
  };

  return (
    <Stack gap={8}>
      <Text size="sm" fw={500}>{t("quota.editor.label")}</Text>

      {value.map((quota, index) => {
        const tag = tagById.get(quota.tag_id);
        const label = tag?.label ?? t("quota.editor.unknownTag");
        /* 当前行自己的标签要留在选项里，否则这一行的 Select 会显示成空的。 */
        const options = [
          { value: quota.tag_id, label },
          ...unusedTags.map((entry) => ({ value: entry.id, label: entry.label })),
        ];
        return (
          <Stack key={quota.tag_id} gap={4}>
            <Group gap={8} wrap="nowrap">
              <Select
                flex={1}
                aria-label={t("quota.editor.tagLabel")}
                value={quota.tag_id}
                data={options}
                disabled={disabled}
                allowDeselect={false}
                onChange={(next) => {
                  if (next) {
                    replaceAt(index, { ...quota, tag_id: next });
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
                aria-label={t("quota.editor.remove", { label })}
                onClick={() => onChange(value.filter((_, position) => position !== index))}
              >
                <TrashIcon size={16} />
              </ActionIcon>
            </Group>
            <ClassTagMembers tag={tag} catalog={catalog} />
          </Stack>
        );
      })}

      <Group gap={8}>
        <Button
          variant="light"
          size="xs"
          leftSection={<PlusIcon size={14} />}
          disabled={!canAdd}
          onClick={() => {
            const next = unusedTags[0];
            if (next) {
              onChange([...value, { tag_id: next.id, required: 1 }]);
            }
          }}
        >
          {t("quota.editor.add")}
        </Button>
        {tags.length === 0 ? (
          <Text size="xs" c="dimmed">{t("quota.editor.noTags")}</Text>
        ) : value.length >= MAX_QUOTAS ? (
          <Text size="xs" c="dimmed">{t("quota.editor.maxReached", { max: MAX_QUOTAS })}</Text>
        ) : null}
      </Group>
    </Stack>
  );
}

/** 一格接受哪些职业，直接摆出图标——不然「治疗」到底包不包某个职业只能靠记。 */
function ClassTagMembers({
  tag,
  catalog,
}: {
  tag: ClassTag | undefined;
  catalog: ReturnType<typeof useClassCatalogStore.getState>["items"];
}) {
  const { t } = useTranslation("events");
  if (!tag || tag.class_ids.length === 0) {
    return <Text size="xs" c="dimmed">{t("quota.editor.emptyTag")}</Text>;
  }
  return (
    <Group gap={4} wrap="wrap">
      {tag.class_ids.map((classId) => {
        const item = resolveClassCatalogItem(classId, catalog);
        return <ClassIcon key={classId} item={item} size={18} label={item.label} />;
      })}
    </Group>
  );
}
