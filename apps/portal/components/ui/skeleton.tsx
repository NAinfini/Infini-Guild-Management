import { cn } from "@portal/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
