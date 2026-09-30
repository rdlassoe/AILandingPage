'use client';

import { useEffect, useState } from 'react';

/** Devuelve `value` tras `delayMs` sin cambios. La primera lectura es inmediata. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
