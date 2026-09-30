import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/layout/page-header';
import { Badge, buttonClassName } from '@/components/ui';
import { requireContext } from '@/lib/auth/session';
import { CodeWorkbench } from '@/features/editor/code-workbench';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { user, store } = await requireContext();
  const landing = await store.getLandingPage(user.id, id);
  return { title: landing ? `Editar ${landing.name}` : 'Editar Landing Page' };
}

export default async function EditLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, store } = await requireContext();

  const landing = await store.getLandingPage(user.id, id);
  // Las paginas publicas de otras cuentas se pueden ver, pero no editar.
  if (!landing || landing.ownerId !== user.id) notFound();

  return (
    <>
      <PageHeader
        eyebrow={`Editor de codigo · v${landing.currentVersion}`}
        title={landing.name}
        description="Edita el HTML a mano, inspecciona la pagina y salta directo a la linea de cada elemento. Los cambios no son definitivos hasta que los guardas."
        actions={
          <>
            {landing.isMock ? <Badge tone="warn">generada en modo demo</Badge> : <Badge tone="accent">{landing.providerId}</Badge>}
            <Link href={`/library/${landing.id}`} className={buttonClassName({ size: 'sm' })}>
              Volver a la ficha
            </Link>
          </>
        }
      />

      <PageBody>
        <CodeWorkbench key={landing.id} landing={landing} />
      </PageBody>
    </>
  );
}
