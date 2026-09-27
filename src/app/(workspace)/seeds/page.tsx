import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { SeedManager } from '@/features/seeds/seed-manager';
import { requireContext } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Seed Strings' };
export const dynamic = 'force-dynamic';

export default async function SeedsPage() {
  const { user, store } = await requireContext();
  const seeds = await store.listSeeds(user.id);

  return (
    <>
      <PageHeader
        eyebrow="Seed String Engine"
        title="Seed Strings"
        description="Direcciones creativas que anclan el contexto semantico de la generacion y evitan que todas las paginas se parezcan."
      />
      <PageBody>
        <SeedManager seeds={seeds} />
      </PageBody>
    </>
  );
}
