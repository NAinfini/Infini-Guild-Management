import { Text } from "@mantine/core";
import { AlertTriangleIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";

type ProfileGapsCalloutProps = {
  avatarKey: string | null;
  titleHtml: string;
  bio: string;
  classList: string[];
  imageList: string[];
  availabilityData: Record<string, unknown> | null;
};

type GapId = "avatar" | "title" | "bio" | "classes" | "images" | "availability";

function hasAvailability(availability: Record<string, unknown> | null): boolean {
  const days = availability?.days;
  if (!days || typeof days !== "object") return false;
  return Object.values(days as Record<string, unknown>).some(
    (rows) => Array.isArray(rows) && rows.length > 0,
  );
}

/**
 * 一行说完哪几栏还空着。
 *
 * 早先每栏后面还跟一句「不填会怎样」，六栏就是六行说教，占掉编辑区顶部一大块，
 * 而读者要的只是「哪几栏没填」。不做完成度百分比：权重没人定得了，而且百分比
 * 也不告诉人该去填哪一栏。
 */
export function ProfileGapsCallout({
  avatarKey,
  titleHtml,
  bio,
  classList,
  imageList,
  availabilityData,
}: ProfileGapsCalloutProps) {
  const { t } = useTranslation("profile");

  const gaps: GapId[] = [];
  if (!avatarKey) gaps.push("avatar");
  if (classList.length === 0) gaps.push("classes");
  if (!titleHtml.trim()) gaps.push("title");
  if (!bio.trim()) gaps.push("bio");
  if (imageList.length === 0) gaps.push("images");
  if (!hasAvailability(availabilityData)) gaps.push("availability");

  if (gaps.length === 0) return null;

  return (
    <section className="profile-gaps">
      <AlertTriangleIcon size={15} className="profile-gaps__icon" />
      <Text size="sm">
        {t("gaps.title", {
          fields: gaps.map((gap) => t(`gaps.field.${gap}`)).join(t("gaps.separator")),
        })}
      </Text>
    </section>
  );
}
