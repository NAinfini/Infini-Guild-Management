import {
  requestConfirmation,
  type ConfirmDialogRequestFn,
} from "./confirmDialogService";

export type {
  ConfirmDialogIntent,
  ConfirmDialogOptions,
  ConfirmDialogRequestFn,
} from "./confirmDialogService";

export function useConfirmDialog(): ConfirmDialogRequestFn {
  return requestConfirmation;
}
