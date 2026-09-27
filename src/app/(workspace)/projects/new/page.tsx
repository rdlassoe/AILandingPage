import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { ProjectWizard } from '@/features/projects/project-wizard';
import { requireContext } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Nuevo proyecto' };
export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const { user, store } = await requireContext();

  const [technologies, seeds] = await Promise.all([
    store.listTechnologies(user.id),
    store.listSeeds(user.id),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title="Nuevo proyecto"
        description="Cinco preguntas. Solo las dos primeras son obligatorias; el resto tiene valores por defecto que podras cambiar despues."
      />
      <PageBody>
        <ProjectWizard technologies={technologies} seeds={seeds} />
      </PageBody>
    </>
  );
}
