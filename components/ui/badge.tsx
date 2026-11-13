import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border  font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      size: {
        default: "px-2.5 py-0.5 text-xs", //tw
        small: "px-2 py-px text-[10px]", //tw
      },
      variant: {
        success:
          "border-transparent bg-success text-success-foreground hover:bg-success/80", //tw
        error:
          "border-transparent bg-danger text-danger-foreground hover:bg-danger/80", //tw
        warning:
          "border-transparent bg-warning text-warning-foreground hover:bg-warning/80", //tw
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default"
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
