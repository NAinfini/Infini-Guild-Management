import { ArrowLeftIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";

type WarHistoryDetailMobileNavigationProps = {
  label: string;
  onBackToList: () => void;
};

export function WarHistoryDetailMobileNavigation({
  label,
  onBackToList,
}: WarHistoryDetailMobileNavigationProps) {
  return (
    <div className="war-history-detail-panel__mobile-nav">
      <Button variant="ghost" onClick={onBackToList}>
        <ArrowLeftIcon size={16} data-icon="inline-start" />
        {label}
      </Button>
    </div>
  );
}
