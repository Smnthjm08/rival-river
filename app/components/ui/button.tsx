import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,translate] duration-150 select-none active:not-aria-[haspopup]:translate-y-px disabled:cursor-not-allowed disabled:border-dashed disabled:border-mist/50 disabled:bg-transparent disabled:text-mist disabled:active:translate-y-0 disabled:has-data-[slot=spinner]:cursor-progress disabled:has-data-[slot=spinner]:border-solid disabled:has-data-[slot=spinner]:border-brass/60 disabled:has-data-[slot=spinner]:text-foreground aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        outline:
          "border-input text-foreground hover:bg-foreground/8 aria-expanded:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)]",
        ghost: "hover:bg-muted hover:text-foreground aria-expanded:bg-muted",
        destructive: "bg-destructive/15 text-destructive hover:bg-destructive/25",
        link: "text-primary underline-offset-4 hover:underline",
        // Kit: fold reads in ember on an outline, never a filled red button.
        fold: "border-input text-fold hover:bg-fold/10",
      },
      // Every size is at least 44px tall: a finger has to hit it.
      size: {
        default: "h-11 gap-2 px-4",
        xs: "h-11 gap-1 px-3 text-xs",
        sm: "h-11 gap-1.5 px-3",
        lg: "h-11 gap-1.5 px-4",
        icon: "size-11",
        "icon-xs": "size-11",
        "icon-sm": "size-11",
        "icon-lg": "size-12",
        // Kit sizes: table actions and page CTAs.
        xl: "h-12 gap-2 rounded-lg px-5 text-base font-semibold",
        "2xl": "h-14 gap-2 rounded-xl px-6 text-base font-semibold sm:text-lg [&_svg:not([class*='size-'])]:size-5",
        pill: "h-11 gap-2 rounded-full px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
