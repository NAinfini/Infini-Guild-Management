import { clsx, type ClassValue } from "clsx";

/** Join optional class names without coupling component code to a styling library. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
