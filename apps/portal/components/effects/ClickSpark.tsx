import { useCallback, useRef, type ReactNode, type MouseEvent } from "react";

export interface ClickSparkProps {
  children: ReactNode;
  className?: string;
  sparkCount?: number;
  sparkColor?: string;
}

export function ClickSpark({
  children,
  className,
  sparkCount = 8,
  sparkColor = "var(--color-primary, #3b82f6)",
}: ClickSparkProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      for (let i = 0; i < sparkCount; i++) {
        const spark = document.createElement("div");
        const angle = (360 / sparkCount) * i + (Math.random() * 30 - 15);
        const distance = 20 + Math.random() * 30;
        const size = 3 + Math.random() * 3;
        const rad = (angle * Math.PI) / 180;

        spark.style.cssText = `
          position: absolute;
          left: ${x}px;
          top: ${y}px;
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          background: ${sparkColor};
          pointer-events: none;
          z-index: 9999;
          box-shadow: 0 0 6px ${sparkColor};
          animation: clickSparkFly 0.6s ease-out forwards;
          --spark-x: ${Math.cos(rad) * distance}px;
          --spark-y: ${Math.sin(rad) * distance}px;
        `;
        container.appendChild(spark);
        setTimeout(() => spark.remove(), 600);
      }
    },
    [sparkCount, sparkColor],
  );

  return (
    <div
      ref={containerRef}
      className={className}
      onClick={handleClick}
      style={{ position: "relative", overflow: "hidden" }}
    >
      {children}
    </div>
  );
}
