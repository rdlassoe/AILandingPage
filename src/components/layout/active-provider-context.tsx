'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import type { ProviderStatus } from '@/lib/llm/registry';
import type { ProviderId } from '@/types/llm';

/**
 * Proveedor de IA "activo" compartido entre la barra lateral y cualquier
 * pantalla que deje elegir proveedor (hoy solo el Prompt Studio).
 *
 * Antes cada pantalla tenia su propio estado local: el indicador de la
 * barra lateral quedaba fijo con el valor calculado en el servidor al
 * cargar la pagina, aunque el usuario cambiara de proveedor en el Prompt
 * Studio. Centralizarlo aqui hace que el indicador se actualice en el
 * mismo instante en que se elige un proveedor, sin recargar.
 */
interface ActiveProviderContextValue {
  activeProviderId: ProviderId;
  setActiveProviderId: (id: ProviderId) => void;
  providerStatuses: ProviderStatus[];
}

const ActiveProviderContext = createContext<ActiveProviderContextValue | null>(null);

export function ActiveProviderProvider({
  initialProviderId,
  providerStatuses,
  children,
}: {
  initialProviderId: ProviderId;
  providerStatuses: ProviderStatus[];
  children: ReactNode;
}) {
  const [activeProviderId, setActiveProviderId] = useState<ProviderId>(initialProviderId);

  return (
    <ActiveProviderContext.Provider value={{ activeProviderId, setActiveProviderId, providerStatuses }}>
      {children}
    </ActiveProviderContext.Provider>
  );
}

export function useActiveProvider(): ActiveProviderContextValue {
  const ctx = useContext(ActiveProviderContext);
  if (!ctx) throw new Error('useActiveProvider debe usarse dentro de <ActiveProviderProvider>.');
  return ctx;
}
