import { AppError } from "@guild/kernel";
import { isPortableLikeSearch } from "@guild/shared";

export function assertPortableLikeSearch(value: string | undefined, label = "Search query"): void {
  if (value && !isPortableLikeSearch(value)) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: `${label} exceeds the portable 50-byte pattern limit`,
    });
  }
}
