import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { ProjectWizard } from '@/features/projects/project-wizard';
import { requireContext } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Nuevo proyecto' };
export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const { user, store } = await requireContext();

  const technologies = await store.listTechnologies(user.id);

  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title="Nuevo proyecto"
        description="Tres pasos. Solo los dos primeros son obligatorios. El estilo, la estructura y las restricciones se deciden al componer el prompt, con las tecnicas que elijas."
      />
      <PageBody>
        <ProjectWizard technologies={technologies} />
      </PageBody>
    </>
  );
}
