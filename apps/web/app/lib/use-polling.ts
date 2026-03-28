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
  const runningRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    async function runPoll() {
      if (runningRef.current || document.visibilityState === "hidden") {
        return;
      }

      runningRef.current = true;
      try {
        await callbackRef.current();
      } finally {
        runningRef.current = false;
      }
    }

    const interval = window.setInterval(() => {
      void runPoll();
    }, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runPoll();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [enabled, intervalMs]);
}
