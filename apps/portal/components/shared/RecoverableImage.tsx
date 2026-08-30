import { PhotoOffIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { withMediaRetry } from "@portal/utils/media";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

type RecoverableImageProps = Omit<ComponentPropsWithoutRef<"img">, "onError" | "src"> & {
  source: string;
  fallbackClassName: string;
  failureLabel: ReactNode;
  retryLabel?: ReactNode;
  retryClassName?: string;
  announceFailure?: boolean;
  iconSize?: number;
};

type ImageAttempt = {
  source: string;
  retries: number;
  failed: boolean;
};

export function RecoverableImage({
  source,
  fallbackClassName,
  failureLabel,
  retryLabel,
  retryClassName,
  announceFailure = false,
  iconSize = 24,
  ...imageProps
}: RecoverableImageProps) {
  const [attempt, setAttempt] = useState<ImageAttempt>({ source, retries: 0, failed: false });
  const isCurrentSource = attempt.source === source;
  const failed = isCurrentSource && attempt.failed;
  const retries = isCurrentSource ? attempt.retries : 0;

  if (failed) {
    return (
      <span
        className={`recoverable-image-fallback ${fallbackClassName}`}
        role={announceFailure ? "status" : undefined}
      >
        <PhotoOffIcon size={iconSize} aria-hidden="true" />
        <span className="recoverable-image-fallback__label">{failureLabel}</span>
        {retryLabel ? (
          <Button type="button" size="sm" variant="outline" className={retryClassName} onClick={() => {
            setAttempt((current) => ({
              source,
              retries: current.source === source ? current.retries + 1 : 1,
              failed: false,
            }));
          }}>
            {retryLabel}
          </Button>
        ) : null}
      </span>
    );
  }

  const imageSource = withMediaRetry(source, retries);

  return (
    <img
      {...imageProps}
      key={imageSource}
      src={imageSource}
      onError={() => {
        setAttempt((current) => ({
          source,
          retries: current.source === source ? current.retries : 0,
          failed: true,
        }));
      }}
    />
  );
}
