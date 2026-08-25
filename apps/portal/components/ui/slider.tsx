import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@portal/lib/utils";

type SliderProps = Omit<SliderPrimitive.Root.Props<number>, "aria-label"> & {
  "aria-label": string;
};

function Slider({ className, "aria-label": ariaLabel, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("w-full", className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full touch-none items-center py-2 select-none">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-muted select-none">
          <SliderPrimitive.Indicator className="rounded-full bg-primary select-none" />
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            className="size-4 rounded-full border border-primary bg-background shadow-sm select-none has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
