import { Button } from "@portal/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@portal/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { SearchIcon, UserPlusIcon, XIcon } from "@portal/components/icons";
import {
  ContentFilterGroup,
  ContentFilterOption,
  ContentFilterToolbar,
} from "@portal/components/shared/ContentFilterToolbar";
import { useTranslation } from "react-i18next";

import type { MemberStatusFilter } from "../../../types/admin";

type AdminUsersToolbarProps = {
  memberSearch: string;
  statusFilter: MemberStatusFilter;
  canCreateMember: boolean;
  onMemberSearchChange: (value: string) => void;
  onStatusFilterChange: (value: MemberStatusFilter) => void;
  onOpenCreateMember: () => void;
};

export function AdminUsersToolbar({
  memberSearch,
  statusFilter,
  canCreateMember,
  onMemberSearchChange,
  onStatusFilterChange,
  onOpenCreateMember,
}: AdminUsersToolbarProps) {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <ContentFilterToolbar
      search={(
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon size={14} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={memberSearch}
            onChange={(event) => onMemberSearchChange(event.currentTarget.value)}
            placeholder={t("member.search.placeholder")}
            aria-label={t("member.search.aria")}
          />
          {memberSearch ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label={t("common:action.clear")} onClick={() => onMemberSearchChange("")} size="icon-xs">
                <XIcon size={14} aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      )}
      filterControls={(
        <ContentFilterGroup label={t("member.filter.status")}>
          <RadioGroup
            aria-label={t("member.filter.status")}
            className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
            value={statusFilter}
            onValueChange={(value) => onStatusFilterChange(value as MemberStatusFilter)}
          >
            {[
              { value: "all", label: t("member.filter.all") },
              { value: "active", label: t("member.status.active") },
              { value: "inactive", label: t("member.status.inactive") },
            ].map((option) => (
              <ContentFilterOption key={option.value}>
                <RadioGroupItem value={option.value} />
                <span>{option.label}</span>
              </ContentFilterOption>
            ))}
          </RadioGroup>
        </ContentFilterGroup>
      )}
      actions={canCreateMember ? (
        <Button size="sm" onClick={onOpenCreateMember}>
          <UserPlusIcon size={14} data-icon="inline-start" />
          {t("member.create.button")}
        </Button>
      ) : null}
      filterLabel={t("common:filter.toggle")}
      activeFilterCount={statusFilter === "all" ? 0 : 1}
      resetLabel={t("common:filter.reset")}
      onReset={() => onStatusFilterChange("all")}
    />
  );
}
