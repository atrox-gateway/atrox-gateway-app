import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 depth-1",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:depth-2",
        secondary: "bg-secondary text-secondary-foreground hover:depth-2",
        destructive: "bg-destructive text-destructive-foreground hover:depth-2",
        outline: "text-foreground bg-muted/50 depth-1",
        success: "bg-success text-success-foreground hover:depth-2",
        warning: "bg-warning text-warning-foreground hover:depth-2",
        info: "bg-info text-info-foreground hover:depth-2",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
