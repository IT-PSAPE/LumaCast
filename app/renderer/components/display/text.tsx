import { cn } from "@renderer/utils/cn"
import type { ComponentPropsWithoutRef, ReactNode } from "react"

type ParagraphProps = { children?: ReactNode; className?: string }
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

function createHeading(tag: HeadingTag, baseClass: string) {
    return ({ children, className, ...props }: ComponentPropsWithoutRef<typeof tag>) => {
        const Tag = tag
        return <Tag className={cn(baseClass, className)} {...props}>{children}</Tag>
    }
}

function createParagraph(baseClass: string) {
    return ({ children, className }: ParagraphProps) => (
        <p className={cn(baseClass, className)}>{children}</p>
    )
}

function createLabel(baseClass: string) {
    return ({ children, className, ...props }: ComponentPropsWithoutRef<'span'>) => (
        <span className={cn(baseClass, className)} {...props}>{children}</span>
    )
}

export function TextBlock({ children, className, ...props }: ComponentPropsWithoutRef<'span'>) {
    return <span className={cn(className)} {...props}>{children}</span>
}

export const Title = {
    h1: createHeading("h1", "title-h1"),
    h2: createHeading("h2", "title-h2"),
    h3: createHeading("h3", "title-h3"),
    h4: createHeading("h4", "title-h4"),
    h5: createHeading("h5", "title-h5"),
    h6: createHeading("h6", "title-h6"),
}

export const Paragraph = {
    lg: createParagraph("paragraph-lg"),
    bg: createParagraph("paragraph-bg"),
    md: createParagraph("paragraph-md"),
    sm: createParagraph("paragraph-sm"),
    xs: createParagraph("paragraph-xs"),
}

export const Label = {
    lg: createLabel("label-lg"),
    bg: createLabel("label-bg"),
    md: createLabel("label-md"),
    sm: createLabel("label-sm"),
    xs: createLabel("label-xs"),
}
