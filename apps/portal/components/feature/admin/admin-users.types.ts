import type { AdminRole } from "@guild/shared";
import type { DataTableColumnDef } from "@portal/components/shared/data-table-features";
import type { AdminUserPendingAction } from "../../../hooks/useAdminMutations";
import type { UsersListResponse } from "../../../services/UserService";

export type AdminUserRow = UsersListResponse["data"][number];

export type AdminUsersSectionProps = {
  usersLoading: boolean;
  usersError: boolean;
  onRetryUsers: () => void;
  canEditUsers: boolean;
  canAssignUserRoles: boolean;
  canActivateUsers: boolean;
  canDeleteUsers: boolean;
  canResetUserPasswords: boolean;
  onOpenCreateMember: () => void;
  selectedUserIds: string[];
  onBatchRole: (userIds: string[], role: string, roleName: string) => void;
  onBatchActivate: (userIds: string[]) => void;
  onBatchDeactivate: (userIds: string[]) => void;
  onBatchDelete: (userIds: string[]) => void;
  onSingleRoleChange: (userId: string, role: string) => void;
  onSingleActivate: (userId: string) => void;
  onSingleDeactivate: (userId: string) => void;
  onSingleResetPassword: (userId: string, currentPassword: string) => void | Promise<void>;
  batchRolePending: boolean;
  batchActivatePending: boolean;
  batchDeactivatePending: boolean;
  batchDeletePending: boolean;
  isSingleActionPending: (userId: string, action: AdminUserPendingAction) => boolean;
  userRows: AdminUserRow[];
  userColumns: DataTableColumnDef<AdminUserRow>[];
  onOpenMemberDetail: (userId: string) => void;
  onSelectionChange: (keys: string[]) => void;
  roles: AdminRole[];
  memberSearch: string;
  onMemberSearchChange: (value: string) => void;
};
