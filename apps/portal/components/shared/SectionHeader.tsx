import type { ReactNode } from "react";
import "./SectionHeader.css";

export interface SectionHeaderProps {
  /** 章节名。全站统一渲染成小号、大写、字距放开的弱化标题。 */
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

  return (
    <div className={className ? `section-header ${className}` : "section-header"}>
      <HeadingTag className="section-header__title">
        {title}
      </HeadingTag>
      <span className="section-header__rule" aria-hidden="true" />
      {trailing != null ? <span className="section-header__trailing">{trailing}</span> : null}
    </div>
  );
}
