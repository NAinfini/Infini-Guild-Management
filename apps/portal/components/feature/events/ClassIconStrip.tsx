import type { ClassCatalogItem } from "@guild/shared";
import { Tooltip } from "@mantine/core";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { resolveClassCatalogItem } from "@portal/utils/class-catalog";

/*
 * 一格配额接受哪些职业，只用图标说。
 *
 * 名字不上屏是故意的：这一格跟名称、人数、删除挤在同一行，写上名字它就得换行或者被
 * 压扁，而配额行一多，参差不齐的行高比省下来的那点信息更难读。放不下的收成 +N，
 * 全名挂在悬浮提示上——鼠标停一下或键盘聚焦就是完整一份，一个都没丢。
 */
const MAX_VISIBLE = 6;

type ClassIconStripProps = {
  classIds: readonly string[];
  catalog: readonly ClassCatalogItem[];
  emptyLabel: string;
};

export function ClassIconStrip({ classIds, catalog, emptyLabel }: ClassIconStripProps) {
  if (classIds.length === 0) {
    return <span className="quota-editor__strip-empty">{emptyLabel}</span>;
  }
  const items = classIds.map((classId) => resolveClassCatalogItem(classId, catalog));
  const hiddenCount = Math.max(0, items.length - MAX_VISIBLE);
  const fullList = items.map((item) => item.label).join(", ");
  return (
    <Tooltip label={fullList} multiline w={260}>
      <span className="quota-editor__strip" aria-label={fullList} tabIndex={0}>
        {items.slice(0, MAX_VISIBLE).map((item) => (
          <ClassIcon key={item.id} item={item} size={18} />
        ))}
        {hiddenCount > 0 ? <span className="quota-editor__strip-more">+{hiddenCount}</span> : null}
      </span>
    </Tooltip>
  );
}
