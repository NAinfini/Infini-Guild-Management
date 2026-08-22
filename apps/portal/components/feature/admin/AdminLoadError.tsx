import { EmptyState } from "@portal/components/shared/EmptyState";
import { Button } from "@mantine/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";

type AdminLoadErrorProps = {
  /** 重新拉取这块数据。管理台里一律接查询对象的 refetch。 */
  onRetry: () => void;
  className?: string;
};

/*
 * 加载失败在管理台里出现十一次，此前一律是一条只报信、不给出路的 Alert：
 * 用户唯一的补救办法是整页刷新，而整页刷新会连带丢掉筛选、选中行和滚动位置。
 * 失败态和空态是同一个位置的两种结果，所以走同一套版式；差别只在语气与动作。
 *
 * onRetry 是必填而不是可选：可选会让调用点静默地漏掉重试，正是这次要消除的缺陷。
 */
export const AdminLoadError = memo(function AdminLoadError({ onRetry, className }: AdminLoadErrorProps) {
  const { t } = useTranslation("common");

  return (
    <EmptyState
      className={className ? `admin-empty ${className}` : "admin-empty"}
      status="error"
      title={t("loadError")}
      actions={
        <Button onClick={onRetry} size="xs" variant="default">
          {t("action.retry")}
        </Button>
      }
    />
  );
});
