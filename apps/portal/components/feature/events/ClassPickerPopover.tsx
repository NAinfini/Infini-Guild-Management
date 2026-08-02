import type { ClassCatalogItem, ClassTag } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { Button, Checkbox, Group, Popover, Text, TextInput, UnstyledButton } from "@mantine/core";
import { ChevronDownIcon, SearchIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClassIconStrip } from "./ClassIconStrip";

const MAX_MEMBERS = LIMITS.content.classesPerTag.max;

type ClassPickerPopoverProps = {
  classIds: string[];
  catalog: readonly ClassCatalogItem[];
  tags: ClassTag[];
  disabled: boolean;
  onChange: (next: string[]) => void;
};

type Section = { key: string; label: string; items: ClassCatalogItem[]; tagClassIds: string[] | null };

/*
 * 一次性组的职业勾选面板。
 *
 * 以前这些职业是一整排按钮直接摊在表单里：目录有二三十个职业，那一排就把整个配额区
 * 顶开，而且它跟隔壁只读的标签图标行长得一模一样，看不出哪一行是能点的。现在收进
 * 一个下拉里，表单里那一格只剩图标。
 *
 * 面板按目录标签分节，一个职业属于几个标签就在几节里出现——那是同一个勾，勾哪边都一样。
 * 每节带一个「整组带入」，因为一次性组常常就是「治疗那几个，再加一个」。
 */
export function ClassPickerPopover({
  classIds,
  catalog,
  tags,
  disabled,
  onChange,
}: ClassPickerPopoverProps) {
  const { t } = useTranslation("events");
  const [search, setSearch] = useState("");
  const selected = new Set(classIds);
  const atMax = selected.size >= MAX_MEMBERS;

  const byId = new Map(catalog.map((item) => [item.id, item]));
  const query = search.trim().toLowerCase();
  const matches = (item: ClassCatalogItem) => query === "" || item.label.toLowerCase().includes(query);

  const grouped = new Set(tags.flatMap((tag) => tag.class_ids));
  const sections: Section[] = [];
  for (const tag of tags) {
    const items = tag.class_ids.map((id) => byId.get(id)).filter((item): item is ClassCatalogItem => Boolean(item));
    const visible = items.filter(matches);
    if (visible.length > 0) {
      sections.push({ key: tag.id, label: tag.label, items: visible, tagClassIds: items.map((item) => item.id) });
    }
  }
  const ungrouped = catalog.filter((item) => !grouped.has(item.id)).filter(matches);
  if (ungrouped.length > 0) {
    sections.push({ key: "__ungrouped", label: t("quota.editor.ungrouped"), items: [...ungrouped], tagClassIds: null });
  }

  const toggle = (classId: string) => {
    onChange(selected.has(classId) ? classIds.filter((entry) => entry !== classId) : [...classIds, classId]);
  };

  /* 整组带入永远带整个标签，不是搜索过滤后的那几个——「治疗」就是治疗那一组。 */
  const bringGroup = (tagClassIds: string[]) => {
    const next = [...classIds];
    for (const classId of tagClassIds) {
      if (!next.includes(classId) && next.length < MAX_MEMBERS) {
        next.push(classId);
      }
    }
    onChange(next);
  };

  return (
    <Popover position="bottom-start" shadow="md" width={320} disabled={disabled} trapFocus>
      <Popover.Target>
        <UnstyledButton
          className="quota-editor__cell quota-editor__cell--picker"
          disabled={disabled}
          aria-label={t("quota.editor.pickClasses")}
        >
          <ClassIconStrip classIds={classIds} catalog={catalog} emptyLabel={t("quota.editor.noneChosen")} />
          <ChevronDownIcon size={14} className="quota-editor__caret" />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown className="quota-editor__picker">
        <TextInput
          size="xs"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={t("quota.editor.searchClasses")}
          aria-label={t("quota.editor.searchClasses")}
          leftSection={<SearchIcon size={14} />}
        />
        {/* 到上限之后没勾上的会一起变灰，不写出来的话那是一片没有理由的灰。 */}
        <Text size="xs" c="dimmed" className="quota-editor__picker-count">
          {t("quota.editor.selectedCount", { count: selected.size, max: MAX_MEMBERS })}
        </Text>
        <div className="quota-editor__picker-list">
          {sections.length === 0 ? (
            <Text size="xs" c="dimmed">{t("quota.editor.noClassMatch")}</Text>
          ) : (
            sections.map((section) => (
              <div key={section.key} className="quota-editor__picker-section">
                <Group gap={8} justify="space-between" wrap="nowrap">
                  <Text size="xs" fw={800} c="dimmed" truncate>{section.label}</Text>
                  {section.tagClassIds ? (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={atMax}
                      onClick={() => bringGroup(section.tagClassIds!)}
                    >
                      {t("quota.editor.bringGroup")}
                    </Button>
                  ) : null}
                </Group>
                {section.items.map((item) => (
                  <Checkbox
                    key={`${section.key}:${item.id}`}
                    size="xs"
                    checked={selected.has(item.id)}
                    disabled={atMax && !selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    label={
                      <Group gap={6} wrap="nowrap">
                        <ClassIcon item={item} size={16} />
                        <Text size="xs">{item.label}</Text>
                      </Group>
                    }
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
