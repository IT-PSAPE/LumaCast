import { extendTailwindMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from './clsx';

// Teach tailwind-merge the semantic radius scale (theme.css --radius-*), or
// `rounded-control` and `rounded-full` would never override each other.
const twMerge = extendTailwindMerge({
    extend: { theme: { radius: ['hairline', 'control', 'container', 'surface'] } },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(...inputs));
}
