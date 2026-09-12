import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { cn } from "@renderer/utils/cn";
import { createContext, useContext, type HTMLAttributes } from "react";

// ─── Item Context ───────────────────────────────────────
// Kept as our own context (rather than reaching into Base UI internals) so
// `useAccordionItem` stays a stable, independently importable hook for any
// descendant of Accordion.Item — populated from Base UI's own item state.

type AccordionItemContextValue = {
    value: string;
    isOpen: boolean;
};

const AccordionItemContext = createContext<AccordionItemContextValue | null>(null);

function useAccordionItem() {
    const context = useContext(AccordionItemContext);
    if (!context) throw new Error("Accordion.Trigger/Content must be used within Accordion.Item");
    return context;
}

// ─── Root ───────────────────────────────────────────────

type AccordionRootProps = HTMLAttributes<HTMLDivElement> & {
    type?: "single" | "multiple";
    defaultValue?: string | string[];
    value?: string | string[];
    onValueChange?: (value: string | string[]) => void;
};

function toArray(value: string | string[] | undefined): string[] | undefined {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value : [value];
}

function AccordionRoot({ type = "single", defaultValue, value, onValueChange, children, className, ...props }: AccordionRootProps) {
    return (
        <BaseAccordion.Root
            multiple={type === "multiple"}
            value={toArray(value)}
            defaultValue={toArray(defaultValue)}
            onValueChange={(nextValues) => onValueChange?.(type === "single" ? nextValues[0] ?? "" : nextValues)}
            className={cn(className)}
            {...props}
        >
            {children}
        </BaseAccordion.Root>
    );
}

// ─── Item ───────────────────────────────────────────────

type AccordionItemProps = HTMLAttributes<HTMLDivElement> & {
    value: string;
    ref?: React.Ref<HTMLDivElement>;
};

function AccordionItem({ value, children, className, ref, ...props }: AccordionItemProps) {
    return (
        <BaseAccordion.Item
            value={value}
            ref={ref}
            className={className}
            render={(itemProps, state) => (
                <div {...itemProps}>
                    <AccordionItemContext.Provider value={{ value, isOpen: state.open }}>
                        {children}
                    </AccordionItemContext.Provider>
                </div>
            )}
            {...props}
        />
    );
}

// ─── Trigger ────────────────────────────────────────────
// Base UI wants a heading wrapping the trigger button; our public API has no
// separate Header part, so Trigger folds it in rather than exposing a new part.

type AccordionTriggerProps = HTMLAttributes<HTMLButtonElement>;

function AccordionTrigger({ children, className, ...props }: AccordionTriggerProps) {
    return (
        <BaseAccordion.Header>
            <BaseAccordion.Trigger className={cn("w-full cursor-pointer text-left", className)} {...props}>
                {children}
            </BaseAccordion.Trigger>
        </BaseAccordion.Header>
    );
}

// ─── Content ────────────────────────────────────────────

type AccordionContentProps = HTMLAttributes<HTMLDivElement>;

function AccordionContent({ children, className, ...props }: AccordionContentProps) {
    return (
        <BaseAccordion.Panel
            keepMounted
            className={cn(
                "h-(--accordion-panel-height) overflow-hidden transition-[height] data-[starting-style]:h-0 data-[ending-style]:h-0",
                className,
            )}
            {...props}
        >
            {children}
        </BaseAccordion.Panel>
    );
}

// ─── Compound Export ────────────────────────────────────

export const Accordion = Object.assign(AccordionRoot, {
    Item: AccordionItem,
    Trigger: AccordionTrigger,
    Content: AccordionContent,
});

export { useAccordionItem };
