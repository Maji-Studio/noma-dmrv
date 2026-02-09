import * as React from "react"
import Link from "next/link"
import Image, { type ImageProps } from "next/image"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* -------------------------------------------------------------------------------------------------
 * Card.Root
 * -----------------------------------------------------------------------------------------------*/

const cardRootVariants = cva(
  "group flex flex-col overflow-hidden bg-[var(--color-background-medium)] border border-[var(--color-border-tertiary)] transition-colors duration-300 hover:border-[var(--color-border-primary)]",
  {
    variants: {
      padding: {
        none: "",
        small: "p-[var(--spacing-16)]",
        medium: "p-[var(--spacing-24)]",
        large: "p-[var(--spacing-40)]",
      },
      radius: {
        default: "rounded-[var(--radius-8)]",
        none: "rounded-none",
      }
    },
    defaultVariants: {
      padding: "none",
      radius: "default",
    },
  }
)

type CardRootProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardRootVariants>

const Root = React.forwardRef<HTMLDivElement, CardRootProps>(
  ({ className, padding, radius, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(cardRootVariants({ padding, radius }), className)}
        {...props}
      />
    )
  }
)
Root.displayName = "Card.Root"

/* -------------------------------------------------------------------------------------------------
 * Card.Link
 * -----------------------------------------------------------------------------------------------*/

type CardLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  ariaLabel?: string
}

const CardLink = React.forwardRef<HTMLAnchorElement, CardLinkProps>(
  ({ className, href, ariaLabel, children, ...props }, ref) => {
    return (
      <Link
        href={href}
        ref={ref}
        aria-label={ariaLabel}
        className={cn("relative block w-full h-full", className)}
        {...props}
      >
        {children}
      </Link>
    )
  }
)
CardLink.displayName = "Card.Link"

/* -------------------------------------------------------------------------------------------------
 * Card.Image
 * -----------------------------------------------------------------------------------------------*/

const cardImageVariants = cva("relative w-full overflow-hidden", {
  variants: {
    aspectRatio: {
      auto: "aspect-auto",
      square: "aspect-square",
      video: "aspect-video",
    },
  },
  defaultVariants: {
    aspectRatio: "auto",
  },
})

type CardImageProps = Omit<ImageProps, "alt"> &
  VariantProps<typeof cardImageVariants> & {
    alt: string
  }

const CardImage = React.forwardRef<HTMLDivElement, CardImageProps>(
  ({ className, aspectRatio, alt, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(cardImageVariants({ aspectRatio }), className)}
      >
        <Image
          alt={alt}
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          {...props}
        />
      </div>
    )
  }
)
CardImage.displayName = "Card.Image"

/* -------------------------------------------------------------------------------------------------
 * Card.Content
 * -----------------------------------------------------------------------------------------------*/

const cardContentVariants = cva("flex flex-col", {
  variants: {
    padding: {
      none: "p-0",
      small: "p-[var(--spacing-16)]",
      medium: "p-[var(--spacing-24)]",
      large: "p-[var(--spacing-40)]",
    },
    gap: {
      small: "gap-[var(--spacing-12)]",
      medium: "gap-[var(--spacing-16)]",
      large: "gap-[var(--spacing-24)]",
    },
  },
  defaultVariants: {
    padding: "medium",
    gap: "medium",
  },
})

type CardContentProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardContentVariants>

const Content = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, padding, gap, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(cardContentVariants({ padding, gap }), className)}
        {...props}
      />
    )
  }
)
Content.displayName = "Card.Content"

/* -------------------------------------------------------------------------------------------------
 * Card.Header
 * -----------------------------------------------------------------------------------------------*/

type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>

const Header = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-[var(--spacing-8)]", className)}
        {...props}
      />
    )
  }
)
Header.displayName = "Card.Header"

/* -------------------------------------------------------------------------------------------------
 * Card.Title
 * -----------------------------------------------------------------------------------------------*/

type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
}

const Title = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as: Component = "h3", ...props }, ref) => {
    return (
      <Component
        ref={ref}
        className={cn("title-heading-3 text-[var(--color-text-primary)]", className)}
        {...props}
      />
    )
  }
)
Title.displayName = "Card.Title"

/* -------------------------------------------------------------------------------------------------
 * Card.Subtitle
 * -----------------------------------------------------------------------------------------------*/

type CardSubtitleProps = React.HTMLAttributes<HTMLParagraphElement>

const Subtitle = React.forwardRef<HTMLParagraphElement, CardSubtitleProps>(
  ({ className, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn("title-chapter-title text-[var(--color-text-secondary)]", className)}
        {...props}
      />
    )
  }
)
Subtitle.displayName = "Card.Subtitle"

/* -------------------------------------------------------------------------------------------------
 * Card.Description
 * -----------------------------------------------------------------------------------------------*/

type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>

const Description = React.forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn("body-large text-[var(--color-text-secondary)]", className)}
        {...props}
      />
    )
  }
)
Description.displayName = "Card.Description"

/* -------------------------------------------------------------------------------------------------
 * Card.Overlay
 * -----------------------------------------------------------------------------------------------*/

const cardOverlayVariants = cva(
  "absolute inset-0 flex flex-col justify-end p-[var(--spacing-24)] bg-[var(--clr-dark-purple-40)] transition-opacity duration-300",
  {
    variants: {
      showOnHover: {
        true: "opacity-0 group-hover:opacity-100",
        false: "opacity-100",
      },
    },
    defaultVariants: {
      showOnHover: true,
    },
  }
)

type CardOverlayProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardOverlayVariants>

const Overlay = React.forwardRef<HTMLDivElement, CardOverlayProps>(
  ({ className, showOnHover, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(cardOverlayVariants({ showOnHover }), className)}
        {...props}
      />
    )
  }
)
Overlay.displayName = "Card.Overlay"

/* -------------------------------------------------------------------------------------------------
 * Card.Footer
 * -----------------------------------------------------------------------------------------------*/

type CardFooterProps = React.HTMLAttributes<HTMLDivElement>

const Footer = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("mt-auto pt-[var(--spacing-16)] flex items-center gap-[var(--spacing-16)]", className)}
        {...props}
      />
    )
  }
)
Footer.displayName = "Card.Footer"

/* -------------------------------------------------------------------------------------------------
 * Card.Icon
 * -----------------------------------------------------------------------------------------------*/

const cardIconVariants = cva("flex items-center justify-center text-[var(--color-text-primary)]", {
  variants: {
    bordered: {
      true: "border border-[var(--color-border-tertiary)] rounded-[var(--radius-8)]",
      false: "",
    },
    size: {
      medium: "w-12 h-12",
      large: "w-[68px] h-[68px]",
    },
  },
  defaultVariants: {
    bordered: false,
    size: "medium",
  },
})

type CardIconProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardIconVariants>

const Icon = React.forwardRef<HTMLDivElement, CardIconProps>(
  ({ className, bordered, size, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(cardIconVariants({ bordered, size }), className)}
        {...props}
      />
    )
  }
)
Icon.displayName = "Card.Icon"

export const Card = {
  Root,
  Link: CardLink,
  Image: CardImage,
  Content,
  Header,
  Title,
  Subtitle,
  Description,
  Overlay,
  Footer,
  Icon,
}
