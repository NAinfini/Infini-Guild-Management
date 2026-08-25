import { Button } from "@portal/components/ui/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminClassesSection } from "./AdminClassesSection";
import { AdminClassTagsSection } from "./AdminClassTagsSection";

/*
 * 职业页签下的两块内容：职业目录本身，和把职业分组的标签。
 *
 * 合在一个页签里而不是各占一个后台页签：它们改的是同一件事的两面，标签只在职业存在之后
 * 才有意义，分成两个顶层页签会让「先建职业再建标签」这条顺序看不出来。两块各自是一整台
 * .admin-md 主从台，所以这里只负责切换，不共享任何状态。
 */
type ClassesPanelView = "classes" | "tags";

export function AdminClassesPanel() {
  const { t } = useTranslation("admin");
  const [view, setView] = useState<ClassesPanelView>("classes");

  const navigation = (
    <div className="admin-classes-panel__switcher" role="group" aria-label={t("classes.panelSwitch")}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={view === "classes"}
        onClick={() => setView("classes")}
      >
        {t("classes.title")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={view === "tags"}
        onClick={() => setView("tags")}
      >
        {t("classTags.title")}
      </Button>
    </div>
  );

  return view === "classes"
    ? <AdminClassesSection masterNavigation={navigation} />
    : <AdminClassTagsSection masterNavigation={navigation} />;
}
