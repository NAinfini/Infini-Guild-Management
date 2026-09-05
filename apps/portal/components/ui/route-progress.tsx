import { useSyncExternalStore } from "react";
import { useIsFetching } from "@tanstack/react-query";
import "./route-progress.css";

let active = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return active;
}

export function startRouteProgress() {
  if (active) return;
  active = true;
  emit();
}

export function completeRouteProgress() {
  if (!active) return;
  active = false;
  emit();
}

export function RouteProgress() {
  const isNavigating = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const fetchingCount = useIsFetching();
  const isActive = isNavigating || fetchingCount > 0;

  return (
    <div className="route-progress" data-active={isActive || undefined} aria-hidden="true">
      <div className="route-progress__bar" />
    </div>
  );
}
