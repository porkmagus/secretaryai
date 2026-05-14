"use client";

import { useCallback, useState } from "react";

/**
 * Shared hook for async data loading with loading/error state.
 * Replaces the repeated `isLoading` + `error` + `async function load()` pattern
 * found across all console components.
 */
export function useAsyncData<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await loader();
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load data.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loader]);

  return { data, setData, error, setError, isLoading, setIsLoading, load };
}

/**
 * Hook for parallel data loading — runs multiple loaders with Promise.all.
 */
export function useParallelLoad<const T extends readonly unknown[]>(
  loaders: (...args: unknown[]) => Promise<T>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await loaders();
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load data.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [loaders]);

  return { data, setData, error, setError, isLoading, setIsLoading, load };
}
