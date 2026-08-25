import { AlertTriangleIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { availabilityToWindows, type MemberAvailability } from "@guild/shared";

type ProfileGapsCalloutProps = {
  avatarMediaId: string | null;
  titleHtml: string;
  bio: string;
  classList: string[];
  imageList: string[];
  availabilityData: MemberAvailability | null;
};

type GapId = "avatar" | "title" | "bio" | "classes" | "images" | "availability";

function hasAvailability(availability: MemberAvailability | null): boolean {
  return availability !== null && availabilityToWindows(availability).length > 0;
}

/**
 * 一行说完哪几栏还空着。
 *
 * 早先每栏后面还跟一句「不填会怎样」，六栏就是六行说教，占掉编辑区顶部一大块，
 * 而读者要的只是「哪几栏没填」。不做完成度百分比：权重没人定得了，而且百分比
 * 也不告诉人该去填哪一栏。
 */
export function ProfileGapsCallout({
  avatarMediaId,
  titleHtml,
  bio,
  classList,
  imageList,
  availabilityData,
}: ProfileGapsCalloutProps) {
  const { t } = useTranslation("profile");

  const gaps: GapId[] = [];
  if (!avatarMediaId) gaps.push("avatar");
  if (classList.length === 0) gaps.push("classes");
  if (!titleHtml.trim()) gaps.push("title");
  if (!bio.trim()) gaps.push("bio");
  if (imageList.length === 0) gaps.push("images");
  if (!hasAvailability(availabilityData)) gaps.push("availability");

  if (gaps.length === 0) return null;

  return (
    <section className="profile-gaps">
      <AlertTriangleIcon size={15} className="profile-gaps__icon" />
      <span className="profile-gaps__text">
        {t("gaps.title", {
          fields: gaps.map((gap) => t(`gaps.field.${gap}`)).join(t("gaps.separator")),
        })}
      </span>
    </section>
  );
}
