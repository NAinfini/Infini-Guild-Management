import { LIMITS, type ClassTag } from "@guild/shared";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { PlusIcon, SaveIcon, TrashIcon } from "@portal/components/icons";
import { useAdminClassTagsController } from "@portal/hooks/useAdminClassTagsController";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useClassCatalogStore } from "@portal/stores/class-catalog";
import { compareClassTags } from "@portal/stores/class-tag";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "../../shared/ClassIcon";
import { EmptyState } from "../../shared/EmptyState";
import "./AdminClassTagsSection.css";

const MAX_MEMBERS = LIMITS.content.classesPerTag.max;

/*
 * 职业标签的管理界面，跟职业目录共用 .admin-md 主从台。
 *
 * 标签里装什么一律不设限：空标签、跟别的标签重叠、装下整个目录都放行——哪些职业算
 * 「治疗」是公会自己的判断（见 apps/shared/schemas/class-tag.ts 里同一条说明）。所以
 * 这个界面上不会出现任何「这样组不合理」的提示，唯一的硬上限是一个标签最多装几个职业。
 *
 * 这里没有拖拽排序，只有一个顺序数字：标签顺序决定活动卡上筹码的排列，改动频率远低于
 * 职业目录，为它单开一个批量重排接口不划算。
 */
export function AdminClassTagsSection() {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const controller = useAdminClassTagsController();
  const { draft } = controller;
  const catalog = useClassCatalogStore((state) => state.items);
  const tags = useMemo(
    () => [...(controller.query.data ?? [])].sort(compareClassTags),
    [controller.query.data],
  );
  const existing = draft.id ? tags.find((tag) => tag.id === draft.id) ?? null : null;
  const canSave = draft.label.trim().length > 0 && draft.classIds.length <= MAX_MEMBERS;

  const handleDelete = async (tag: ClassTag) => {
    const accepted = await confirm({
      title: t("classTags.confirmDelete.title"),
      /* 删标签会连同正在用它的配额格一起删掉，所以这句话必须报出有多少格在用。
         报 0 的时候也照样说，「没有活动在用」本身就是管理员想确认的事。 */
      description: t("classTags.confirmDelete.description", {
        name: tag.label,
        count: tag.usage_count,
      }),
      confirmLabel: t("classTags.action.delete"),
      cancelLabel: tc("action.cancel"),
      intent: "danger",
    });
    if (accepted) await controller.remove(tag.id);
  };

  return (
    <div className="admin-md">
      <div className="admin-md__master">
        <div className="admin-md__master-head">
          <Group gap={8} justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text fw={700} size="sm">{t("classTags.title")}</Text>
              <Text size="xs" c="dimmed">{t("classTags.count", { count: tags.length })}</Text>
            </div>
            <ActionIcon
              size="sm"
              variant="filled"
              color="portal-brand"
              onClick={controller.openCreate}
              aria-label={t("classTags.action.create")}
            >
              <PlusIcon size={14} />
            </ActionIcon>
          </Group>
        </div>

        <ScrollArea className="admin-md__list" type="auto" scrollbarSize={6}>
          <Stack gap={2} p={6}>
            {controller.query.isLoading ? (
              Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} height={40} radius="md" />)
            ) : controller.query.isError ? (
              <EmptyState
                status="error"
                title={tc("loadError")}
                actions={(
                  <Button variant="default" size="sm" onClick={() => void controller.query.refetch()}>
                    {tc("action.retry")}
                  </Button>
                )}
              />
            ) : tags.length === 0 ? (
              <EmptyState
                title={t("classTags.empty.title")}
                description={t("classTags.empty.description")}
                actions={(
                  <Button size="sm" onClick={controller.openCreate}>{t("classTags.action.create")}</Button>
                )}
              />
            ) : (
              tags.map((tag) => (
                <UnstyledButton
                  key={tag.id}
                  className={`admin-md__item ${controller.opened && draft.id === tag.id ? "admin-md__item--active" : ""}`}
                  onClick={() => controller.openEdit(tag)}
                >
                  <span className="admin-md__item-main">
                    <Text size="sm" fw={500} truncate>{tag.label}</Text>
                  </span>
                  <span className="admin-md__item-meta">
                    <Badge size="xs" variant="light" color="gray">
                      {tag.class_ids.length}
                    </Badge>
                  </span>
                </UnstyledButton>
              ))
            )}
          </Stack>
        </ScrollArea>
      </div>

      <div className="admin-md__detail">
        {controller.opened ? (
          <>
            <div className="admin-md__detail-head">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Text fw={700} size="sm">
                  {draft.id ? t("classTags.editTitle") : t("classTags.createTitle")}
                </Text>
                {existing ? (
                  <Tooltip label={t("classTags.action.delete")} withArrow>
                    {/* size={44} 是 19788bf「improve tablet accessibility」定的触控靶面。 */}
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      color="red"
                      onClick={() => void handleDelete(existing)}
                      loading={controller.deletePending}
                      aria-label={t("classTags.action.delete")}
                    >
                      <TrashIcon size={16} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
              </Group>
            </div>

            <ScrollArea className="admin-md__detail-body" type="auto" scrollbarSize={6}>
              <div className="admin-md__detail-pad">
                <Stack gap={16}>
                  <div className="admin-class-tags__form-row">
                    <TextInput
                      label={t("classTags.field.label")}
                      value={draft.label}
                      maxLength={LIMITS.content.classTagLabel.max}
                      onChange={(event) => {
                        /* 先当场取值：setDraft 的 updater 是 React 之后才调用的，
                           那时 event.currentTarget 已经是 null。 */
                        const { value } = event.currentTarget;
                        controller.setDraft((current) => ({ ...current, label: value }));
                      }}
                      required
                    />
                    <NumberInput
                      label={t("classTags.field.order")}
                      hideControls
                      value={draft.sortOrder}
                      min={0}
                      max={100_000}
                      clampBehavior="strict"
                      onChange={(value) => controller.setDraft((current) => ({
                        ...current,
                        sortOrder: typeof value === "number" ? value : 0,
                      }))}
                    />
                  </div>

                  <div>
                    <Text size="sm" fw={600}>{t("classTags.field.members")}</Text>
                    <Text size="xs" c="dimmed" mb={8}>
                      {t("classTags.field.membersDescription", { max: MAX_MEMBERS })}
                    </Text>
                    {catalog.length === 0 ? (
                      <Text size="xs" c="dimmed">{t("classTags.noClasses")}</Text>
                    ) : (
                      <div
                        className="admin-class-tags__member-grid"
                        role="group"
                        aria-label={t("classTags.field.members")}
                      >
                        {catalog.map((item) => {
                          const selected = draft.classIds.includes(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={`admin-class-tags__member${selected ? " admin-class-tags__member--selected" : ""}`}
                              aria-pressed={selected}
                              /* 没选中时也允许点满上限之外？不允许：超出上限服务端会截断，
                                 界面先拦住，免得存完发现少了几个。 */
                              disabled={!selected && draft.classIds.length >= MAX_MEMBERS}
                              onClick={() => controller.toggleClass(item.id)}
                            >
                              <ClassIcon item={item} size={20} label={item.label} />
                              <span className="admin-class-tags__member-label">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {existing ? (
                    <Text size="xs" c="dimmed">
                      {t("classTags.usage", { count: existing.usage_count })}
                    </Text>
                  ) : null}

                  <Group justify="flex-end" gap={8}>
                    <Button variant="default" onClick={controller.close} disabled={controller.savePending}>
                      {tc("action.cancel")}
                    </Button>
                    <Button
                      leftSection={<SaveIcon size={16} />}
                      onClick={controller.save}
                      loading={controller.savePending}
                      disabled={!canSave}
                    >
                      {t("classTags.action.save")}
                    </Button>
                  </Group>
                </Stack>
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="admin-md__empty">
            <EmptyState title={t("classTags.selectHint")} description={t("classTags.description")} />
          </div>
        )}
      </div>
    </div>
  );
}
