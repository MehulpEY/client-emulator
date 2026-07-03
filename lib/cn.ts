import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names with Tailwind conflict resolution.
 * `clsx` flattens conditionals/arrays/objects; `twMerge` resolves conflicting
 * Tailwind utilities so the *last* one wins (`p-2 p-4` -> `p-4`). Single
 * class-name helper for the whole app.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export default cn;
