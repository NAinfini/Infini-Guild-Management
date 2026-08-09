import { SegmentedControl } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { type EventWorkbenchViewMode } from "../../../utils/event-navigation";

type EventsViewSwitcherProps = {
  viewMode: EventWorkbenchViewMode;
  canManage: boolean;
  onViewModeChange: (value: EventWorkbenchViewMode) => void;
};

/*
 * 卡片 / 月 / 周期 三档的唯一切换器。抽出来是因为它现在挂在两个工具栏上：活动档
 * 挂在 EventsFiltersCard，模板档挂在 RecurringTemplatesTab 自己那条筛选栏里
 * （模板档不渲染活动筛选卡，否则就是上下两条工具栏）。两处各写一份 data 数组，
 * 迟早会漏掉一档——尤其是 canManage 这条权限判断。
 *
 * 模板档只对有管理权限的人存在；无权限时连档位都不出现，避免点进去只看到空面板。
 */
export function EventsViewSwitcher({ viewMode, canManage, onViewModeChange }: EventsViewSwitcherProps) {
  const { t } = useTranslation("events");

  return (
    <SegmentedControl
      value={viewMode}
      onChange={(value) => onViewModeChange(value as EventWorkbenchViewMode)}
      data={[
        { value: "cards", label: t("view.cards") },
        { value: "month", label: t("view.calendar") },
        ...(canManage ? [{ value: "recurring", label: t("view.recurring") }] : []),
      ]}
      className="events-filter-view"
    />
  );
}
