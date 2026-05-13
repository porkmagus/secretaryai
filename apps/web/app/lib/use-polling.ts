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
  const lastRanRef = useRef(0);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let interval: number;

    async function runPoll() {
      const now = Date.now();
      if (
        runningRef.current ||
        document.visibilityState === "hidden" ||
        now - lastRanRef.current < intervalMs / 2
      ) {
        return;
      }

      runningRef.current = true;
      lastRanRef.current = now;
      try {
        await callbackRef.current();
      } finally {
        runningRef.current = false;
      }
    }

    interval = window.setInterval(() => {
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
