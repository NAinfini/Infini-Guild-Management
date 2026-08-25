import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { forwardRef, useState, type ComponentProps } from "react";

import { cn } from "@portal/lib/utils";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";

type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type"> & {
  showPasswordLabel: string;
  hidePasswordLabel: string;
};

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  {
    className,
    showPasswordLabel,
    hidePasswordLabel,
    ...props
  },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const actionLabel = visible ? hidePasswordLabel : showPasswordLabel;

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground"
        aria-label={actionLabel}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <IconEyeOff aria-hidden="true" /> : <IconEye aria-hidden="true" />}
      </Button>
    </div>
  );
});

export { PasswordInput };
