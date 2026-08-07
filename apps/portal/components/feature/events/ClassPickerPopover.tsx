import type { ClassCatalogItem, ClassTag } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { Popover, UnstyledButton } from "@mantine/core";
import { ChevronDownIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { PickList } from "@portal/components/shared/PickList";
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

type Group = { key: string; label: string; items: ClassCatalogItem[] };

// A class may appear in multiple tag sections, but every occurrence controls
// the same selected-ID set.
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

  const byId = new Map(catalog.map((item) => [item.id, item]));
  const query = search.trim().toLowerCase();
  const matches = (item: ClassCatalogItem) => query === "" || item.label.toLowerCase().includes(query);

  const grouped = new Set(tags.flatMap((tag) => tag.class_ids));
  const groups: Group[] = [];
  for (const tag of tags) {
    const items = tag.class_ids.map((id) => byId.get(id)).filter((item): item is ClassCatalogItem => Boolean(item));
    const visible = items.filter(matches);
    if (visible.length > 0) {
      groups.push({ key: tag.id, label: tag.label, items: visible });
    }
  }
  const ungrouped = catalog.filter((item) => !grouped.has(item.id)).filter(matches);
  if (ungrouped.length > 0) {
    groups.push({ key: "__ungrouped", label: t("quota.editor.ungrouped"), items: [...ungrouped] });
  }

  const toggle = (classId: string) => {
    onChange(selected.has(classId) ? classIds.filter((entry) => entry !== classId) : [...classIds, classId]);
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
        <PickList
          size="xs"
          aria-label={t("quota.editor.pickClasses")}
          sections={groups.map((group) => ({
            key: group.key,
            label: group.label,
            options: group.items.map((item) => ({
              id: item.id,
              label: item.label,
              icon: <ClassIcon item={item} size={16} />,
            })),
          }))}
          selected={selected}
          onToggle={toggle}
          max={MAX_MEMBERS}
          emptyLabel={t("quota.editor.noClassMatch")}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("quota.editor.searchClasses"),
          }}
        />
      </Popover.Dropdown>
    </Popover>
  );
}
