'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';

import { Alert, Badge, Button, Field, Input, Panel, PanelBody, PanelHeader, Select, Textarea } from '@/components/ui';
import { TagInput } from '@/components/ui/tag-input';
import { apiDelete, apiPost } from '@/lib/api-client';
import type { Technology, TechnologyCategory } from '@/types/domain';

/**
 * Gestor de tecnologias.
 *
 * Las tecnologias son datos, no codigo: viven en el DataStore y cualquiera
 * puede anadir las suyas con sus propias instrucciones de prompt. Las de
 * catalogo (ownerId nulo) son de solo lectura.
 */

const CATEGORIES: Array<{ value: TechnologyCategory; label: string }> = [
  { value: 'markup', label: 'Marcado' },
  { value: 'styling', label: 'Estilos' },
  { value: 'language', label: 'Lenguaje' },
  { value: 'framework', label: 'Framework' },
  { value: 'library', label: 'Libreria' },
  { value: 'tooling', label: 'Herramienta' },
  { value: 'icons', label: 'Iconografia' },
];

export function TechnologyManager({ technologies }: { technologies: Technology[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<TechnologyCategory>('library');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [promptInstructions, setPromptInstructions] = useState('');
  const [constraints, setConstraints] = useState<string[]>([]);
  const [outputRequirements, setOutputRequirements] = useState<string[]>([]);
  const [selfContained, setSelfContained] = useState(true);

  const reset = () => {
    setName('');
    setVersion('');
    setDescription('');
    setPromptInstructions('');
    setConstraints([]);
    setOutputRequirements([]);
    setSelfContained(true);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);

    const result = await apiPost<Technology>('/api/technologies', {
      name,
      category,
      version: version.trim() || null,
      description,
      promptInstructions,
      constraints,
      outputRequirements,
      conflictsWith: [],
      priority: 20,
      selfContainedPreview: selfContained,
      isActive: true,
      sortOrder: 500,
    });

    if (!result.ok) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }

    reset();
    setCreating(false);
    setSubmitting(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    const result = await apiDelete(`/api/technologies/${id}`);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
  };

  const presets = technologies.filter((tech) => tech.ownerId === null);
  const own = technologies.filter((tech) => tech.ownerId !== null);

  return (
    <div className="grid gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Panel>
        <PanelHeader
          eyebrow="Catalogo"
          title="Tecnologias disponibles"
          description="Cada tecnologia aporta su bloque de instrucciones, sus restricciones y sus requisitos de salida al prompt final."
          actions={
            <Button variant={creating ? 'secondary' : 'primary'} onClick={() => setCreating((value) => !value)}>
              <Plus className="size-4" aria-hidden="true" />
              {creating ? 'Cancelar' : 'Anadir tecnologia'}
            </Button>
          }
        />

        {creating ? (
          <PanelBody className="grid gap-4 border-b border-line bg-panel-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Nombre" htmlFor="tech-name" required>
                <Input id="tech-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Svelte" />
              </Field>
              <Field label="Categoria" htmlFor="tech-category">
                <Select
                  id="tech-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as TechnologyCategory)}
                >
                  {CATEGORIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Version" htmlFor="tech-version">
                <Input id="tech-version" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="5" />
              </Field>
            </div>

            <Field label="Descripcion" htmlFor="tech-description">
              <Input
                id="tech-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Compilador de componentes sin runtime"
              />
            </Field>

            <Field
              label="Instrucciones para el prompt"
              htmlFor="tech-instructions"
              required
              hint="Lo que el modelo debe hacer exactamente cuando se use esta tecnologia."
            >
              <Textarea
                id="tech-instructions"
                rows={6}
                value={promptInstructions}
                onChange={(event) => setPromptInstructions(event.target.value)}
                placeholder={'Usa componentes .svelte con <script> y estilos con alcance local.\nEvita stores globales para una landing estatica.'}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Restricciones" htmlFor="tech-constraints">
                <TagInput
                  id="tech-constraints"
                  value={constraints}
                  onChange={setConstraints}
                  placeholder="Sin dependencias externas"
                />
              </Field>
              <Field label="Requisitos de salida" htmlFor="tech-output">
                <TagInput
                  id="tech-output"
                  value={outputRequirements}
                  onChange={setOutputRequirements}
                  placeholder="Componentes exportados y ensamblados"
                />
              </Field>
            </div>

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={selfContained}
                onChange={(event) => setSelfContained(event.target.checked)}
                className="mt-1 size-3.5 accent-[var(--accent)]"
              />
              <span className="text-muted">
                Puede producir un documento HTML autocontenido para la vista previa. Desmarcalo si necesita
                compilacion: el prompt pedira ademas un HTML equivalente.
              </span>
            </label>

            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={submit}
                loading={submitting}
                disabled={name.trim().length < 2 || promptInstructions.trim().length < 10}
              >
                Guardar tecnologia
              </Button>
              <Button onClick={() => setCreating(false)} disabled={submitting}>
                Cancelar
              </Button>
            </div>
          </PanelBody>
        ) : null}

        <ul className="divide-y divide-line">
          {[...own, ...presets].map((tech) => (
            <li key={tech.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    {tech.name}
                    {tech.version ? <span className="font-mono text-xs text-faint">{tech.version}</span> : null}
                    {tech.ownerId === null ? (
                      <span title="Tecnologia del catalogo, de solo lectura">
                        <Lock className="size-3 text-faint" aria-hidden="true" />
                        <span className="sr-only">Del catalogo</span>
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted">{tech.description}</p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <Badge>{tech.category}</Badge>
                  {!tech.selfContainedPreview ? <Badge tone="warn">requiere build</Badge> : null}
                  {tech.ownerId !== null ? (
                    <Button variant="danger" size="sm" onClick={() => remove(tech.id)}>
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Eliminar {tech.name}</span>
                    </Button>
                  ) : null}
                </div>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-accent">Ver instrucciones de prompt</summary>
                <pre className="mt-1.5 whitespace-pre-wrap break-words border border-line bg-bg p-2.5 font-mono text-xs leading-relaxed text-muted">
                  {tech.promptInstructions}
                </pre>
                {tech.constraints.length > 0 ? (
                  <div className="mt-2">
                    <p className="eyebrow mb-1">Restricciones</p>
                    <ul className="grid gap-0.5 text-xs text-muted">
                      {tech.constraints.map((item) => (
                        <li key={item}>&middot; {item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
