import { SegmentedControl, Stack } from "@mantine/core";
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

  return (
    <Stack gap={12}>
      <SegmentedControl
        value={view}
        onChange={(value) => setView(value as ClassesPanelView)}
        data={[
          { value: "classes", label: t("classes.title") },
          { value: "tags", label: t("classTags.title") },
        ]}
        aria-label={t("classes.panelSwitch")}
      />
      {view === "classes" ? <AdminClassesSection /> : <AdminClassTagsSection />}
    </Stack>
  );
}
