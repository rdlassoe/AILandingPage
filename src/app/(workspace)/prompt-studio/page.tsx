import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { PromptStudio } from '@/features/studio/prompt-studio';
import { Spinner } from '@/components/ui';
import { requireContext } from '@/lib/auth/session';
import { getUserCredentials } from '@/lib/credentials/server';
import { getRuntimeConfigSummary } from '@/lib/env';
import { getProviderSummaries } from '@/lib/llm/registry';
import { DESIGN_TECHNIQUES, DEFAULT_TECHNIQUE_IDS } from '@/services/prompt-engine';

export const metadata: Metadata = { title: 'Prompt Studio' };
export const dynamic = 'force-dynamic';

export default async function PromptStudioPage() {
  const { user, store } = await requireContext();

  const credentials = await getUserCredentials(user.id);
  const [projects, providers] = await Promise.all([store.listProjects(user.id), getProviderSummaries(credentials)]);

  return (
    <>
      <PageHeader
        eyebrow="Deliver"
        title="Prompt Studio"
        description="Compon el prompt, ejecutalo, revisa la vista previa y refina con la ayuda del agente critico."
      />
      <PageBody>
        <Suspense fallback={<Spinner label="Cargando el estudio" />}>
          <PromptStudio
            projects={projects}
            providers={providers}
            techniques={DESIGN_TECHNIQUES}
            defaultTechniqueIds={DEFAULT_TECHNIQUE_IDS}
            imageGenerationConfigured={getRuntimeConfigSummary(credentials).imageGeneration.configured}
          />
        </Suspense>
      </PageBody>
    </>
  );
}
