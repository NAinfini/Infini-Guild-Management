import type { ReactNode } from "react";
import "./SectionHeader.css";

export interface SectionHeaderProps {
  /** 章节名。保持小号标签排版；页面级 h2 使用主文字色，卡片内标题保持弱化。 */
  title: ReactNode;
  /** 右侧的次要信息，通常是计数（「图片 3/10」）或状态文本。可省。 */
  trailing?: ReactNode;
  /** 按页面语义选择标题级别；卡片内默认使用 h3。 */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** Shared semantic heading for sections inside cards. */
export function SectionHeader({
  title,
  trailing,
  headingLevel = 3,
  className,
}: SectionHeaderProps) {
  const HeadingTag = headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3";
  const titleClassName =
    headingLevel === 2
      ? "section-header__title section-header__title--major"
      : "section-header__title";

  return (
    <div className={className ? `section-header ${className}` : "section-header"}>
      <HeadingTag className={titleClassName}>{title}</HeadingTag>
      <span className="section-header__rule" aria-hidden="true" />
      {trailing != null ? <span className="section-header__trailing">{trailing}</span> : null}
    </div>
  );
}
