import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useTranslation } from "react-i18next";

type WikiCategoryEditorCardProps = {
  canEdit: boolean;
  categoryName: string;
  categorySortOrder: number;
  selectedCategoryId?: string;
  isCreating: boolean;
  isSaving: boolean;
  onCategoryNameChange: (value: string) => void;
  onCategorySortOrderChange: (value: number) => void;
  onCreateCategory: () => void;
  onSaveSelectedCategory: () => void;
};

export function WikiCategoryEditorCard({
  canEdit,
  categoryName,
  categorySortOrder,
  selectedCategoryId,
  isCreating,
  isSaving,
  onCategoryNameChange,
  onCategorySortOrderChange,
  onCreateCategory,
  onSaveSelectedCategory,
}: WikiCategoryEditorCardProps) {
  const { t } = useTranslation("wiki");

  if (!canEdit) {
    return null;
  }

  return (
    <InfiniCard>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={10}>
          <Text fw={600}>{t("categoryEditor.title")}</Text>
          <TextInput
            value={categoryName}
            onChange={(event) => onCategoryNameChange(event.currentTarget.value)}
            placeholder={t("categoryEditor.name")}
            aria-label="Wiki category name"
          />
          <TextInput
            type="number"
            value={categorySortOrder}
            onChange={(event) => onCategorySortOrderChange(Number(event.currentTarget.value))}
            placeholder={t("categoryEditor.sortOrder")}
            aria-label="Wiki category sort order"
          />
          <Group gap={8} wrap="wrap">
            <MotionButton type="primary" onClick={onCreateCategory} loading={isCreating}>
              {t("categoryEditor.create")}
            </MotionButton>
            {selectedCategoryId ? (
              <Button onClick={onSaveSelectedCategory} loading={isSaving}>
                {t("categoryEditor.saveSelected")}
              </Button>
            ) : null}
          </Group>
        </Stack>
      </div>
    </InfiniCard>
  );
}

