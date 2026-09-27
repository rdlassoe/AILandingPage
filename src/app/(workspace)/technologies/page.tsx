import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { TechnologyManager } from '@/features/technologies/technology-manager';
import { requireContext } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Tecnologias' };
export const dynamic = 'force-dynamic';

export default async function TechnologiesPage() {
  const { user, store } = await requireContext();
  const technologies = await store.listTechnologies(user.id);

  return (
    <>
      <PageHeader
        eyebrow="Technology Manager"
        title="Tecnologias"
        description="Las tecnologias son datos, no codigo: cada una aporta sus instrucciones al prompt y puedes anadir las tuyas."
      />
      <PageBody>
        <TechnologyManager technologies={technologies} />
      </PageBody>
    </>
  );
}
