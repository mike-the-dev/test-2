"use client";

import { useEffect, useState } from "react";

/**
 * Returns a value that trails the input by `delay` ms — the debounced value
 * only updates once the input has stopped changing for the delay window.
 *
 * Standard input-debounce pattern used to avoid hammering expensive side
 * effects (external APIs, heavy reflows) on every keystroke.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
