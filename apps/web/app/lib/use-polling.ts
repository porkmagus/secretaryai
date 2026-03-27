"use client";

import { useEffect, useRef } from "react";

export function usePolling({
  enabled,
  intervalMs,
  callback,
}: {
  enabled: boolean;
  intervalMs: number;
  callback: () => void | Promise<void>;
}) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void callbackRef.current();
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [enabled, intervalMs]);
}
