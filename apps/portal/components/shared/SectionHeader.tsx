import type { ReactNode } from "react";
import "./SectionHeader.css";

export interface SectionHeaderProps {
  /** 章节名。全站统一渲染成小号、大写、字距放开的弱化标题。 */
  title: ReactNode;
  /** 右侧的次要信息，通常是计数（「图片 3/10」）或状态文本。可省。 */
  trailing?: ReactNode;
  className?: string;
}

/**
 * 卡片内的章节标题。样式全部在 SectionHeader.css 里，调用点不再各自拼
 * Mantine 的 fw/size/c/tt/lts 组合 —— 那是此前 20 处逐字重复的来源。
 */
export function SectionHeader({ title, trailing, className }: SectionHeaderProps) {
  return (
    <div className={className ? `section-header ${className}` : "section-header"}>
      <span className="section-header__title">{title}</span>
      <span className="section-header__rule" aria-hidden="true" />
      {trailing != null ? <span className="section-header__trailing">{trailing}</span> : null}
    </div>
  );
}
