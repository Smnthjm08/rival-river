"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color] duration-150 hover:bg-foreground/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent aria-pressed:bg-muted data-[state=on]:bg-muted",
        outline: "border border-input bg-transparent aria-pressed:bg-muted data-[state=on]:bg-muted",
        // Kit: a pressed stake reads in brass.
        stake:
          "border-[1.5px] border-input bg-transparent font-mono font-semibold aria-pressed:border-brass aria-pressed:bg-brass/15 aria-pressed:text-brass",
        // A choice that isn't money: pressed reads in river.
        choice:
          "border-[1.5px] border-input bg-transparent font-semibold aria-pressed:border-river aria-pressed:bg-river/15",
      },
      size: {
        default: "h-11 min-w-11 px-3",
        sm: "h-11 min-w-11 px-3",
        lg: "h-12 min-w-12 px-4",
        xl: "h-14 min-w-14 rounded-lg px-3 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
