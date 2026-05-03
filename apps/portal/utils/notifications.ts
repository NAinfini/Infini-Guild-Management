import { notifications } from "@mantine/notifications";

export function notifySuccess(message: string) {
  notifications.show({ color: "green", message });
}

export function notifyError(message: string) {
  notifications.show({ color: "red", message });
}

export function notifyWarning(message: string) {
  notifications.show({ color: "yellow", message });
}
