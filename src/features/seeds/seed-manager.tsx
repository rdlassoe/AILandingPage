'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dices, Lock, Plus, Trash2 } from 'lucide-react';

import { Alert, Badge, Button, Field, Input, Panel, PanelBody, PanelHeader, Select, Textarea } from '@/components/ui';
import { apiDelete, apiPost } from '@/lib/api-client';
import type { SeedCategory, SeedDirectives, SeedString } from '@/types/domain';

/**
 * Gestor de Seed Strings.
 *
 * Una Seed no es decoracion: se traduce a directrices concretas de
 * composicion, tipografia, color, jerarquia, espaciado, imagen y componentes,
 * y esas directrices viajan al prompt.
 */

const CATEGORIES: Array<{ value: SeedCategory; label: string }> = [
  { value: 'editorial', label: 'Editorial' },
  { value: 'bauhaus', label: 'Bauhaus' },
  { value: 'swiss', label: 'Minimalismo suizo' },
  { value: 'brutalist', label: 'Brutalismo' },
  { value: 'industrial', label: 'Diseno industrial' },
  { value: 'magazine', label: 'Revista' },
  { value: 'retro-tech', label: 'Retro tecnologico' },
  { value: 'documentary', label: 'Fotografia documental' },
  { value: 'architecture', label: 'Arquitectura' },
  { value: 'art', label: 'Arte' },
  { value: 'luxury', label: 'Lujo' },
  { value: 'natural', label: 'Natural' },
  { value: 'experimental', label: 'Experimental' },
];

const DIRECTIVE_FIELDS: Array<{ key: keyof SeedDirectives; label: string; placeholder: string }> = [
  { key: 'composition', label: 'Composicion', placeholder: 'Retícula de 12 columnas visible y respetada.' },
  { key: 'typography', label: 'Tipografia', placeholder: 'Una grotesca en tres pesos, escala modular 1.25.' },
  { key: 'color', label: 'Color', placeholder: 'Fondo hueso, texto casi negro, un acento saturado.' },
  { key: 'hierarchy', label: 'Jerarquia', placeholder: 'Jerarquia por tamano, nunca por cajas de color.' },
  { key: 'spacing', label: 'Espaciado', placeholder: 'Multiplos de 8; el aire es un elemento de diseno.' },
  { key: 'imagery', label: 'Imagen', placeholder: 'Fotografia documental alineada a la retícula.' },
  { key: 'components', label: 'Componentes', placeholder: 'Botones rectangulares, filetes de 1px, sin sombras.' },
];

const EMPTY_DIRECTIVES: SeedDirectives = {
  composition: '',
  typography: '',
  color: '',
  hierarchy: '',
  spacing: '',
  imagery: '',
  components: '',
};

export function SeedManager({ seeds }: { seeds: SeedString[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<SeedCategory>('editorial');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [directives, setDirectives] = useState<SeedDirectives>(EMPTY_DIRECTIVES);

  const setDirective = (key: keyof SeedDirectives, next: string) => {
    setDirectives((current) => ({ ...current, [key]: next }));
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);

    const result = await apiPost<SeedString>('/api/seeds', {
      name,
      category,
      value,
      description,
      directives,
    });

    if (!result.ok) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }

    setName('');
    setValue('');
    setDescription('');
    setDirectives(EMPTY_DIRECTIVES);
    setCreating(false);
    setSubmitting(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    const result = await apiDelete(`/api/seeds/${id}`);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
  };

  /**
   * Compositor de Seed. Combina ejes semanticos para explorar direcciones
   * distintas. Es una ayuda creativa, no un generador criptografico.
   */
  const suggest = () => {
    const axes = [
      ['diseno suizo', 'Bauhaus funcional', 'brutalismo web', 'modernismo escandinavo', 'minimalismo japones'],
      ['hormigon visto', 'papel prensa', 'acero cepillado', 'madera sin tratar', 'vidrio industrial'],
      ['cartografia', 'instrumentacion de laboratorio', 'senaletica aeroportuaria', 'fotografia documental'],
      ['orden frente a accidente', 'densidad frente a vacio', 'norma frente a excepcion'],
    ];
    setValue(axes.map((options) => options[Math.floor(Math.random() * options.length)] ?? '').join(' + '));
  };

  const presets = seeds.filter((seed) => seed.isPreset);
  const own = seeds.filter((seed) => !seed.isPreset);

  return (
    <div className="grid gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Panel>
        <PanelHeader
          eyebrow="Direccion creativa"
          title="Seed Strings"
          description="Anclan el contexto semantico de la generacion para que no todas las paginas converjan hacia el mismo aspecto."
          actions={
            <Button variant={creating ? 'secondary' : 'primary'} onClick={() => setCreating((current) => !current)}>
              <Plus className="size-4" aria-hidden="true" />
              {creating ? 'Cancelar' : 'Nueva Seed'}
            </Button>
          }
        />

        {creating ? (
          <PanelBody className="grid gap-4 border-b border-line bg-panel-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" htmlFor="seed-name" required>
                <Input
                  id="seed-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Archivo cientifico"
                />
              </Field>
              <Field label="Categoria" htmlFor="seed-category">
                <Select
                  id="seed-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as SeedCategory)}
                >
                  {CATEGORIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field
              label="Cadena"
              htmlFor="seed-value"
              required
              hint="Combina 3-5 referencias separadas por +. Cuanto mas concretas, mas util."
            >
              <div className="grid gap-2">
                <Textarea
                  id="seed-value"
                  rows={2}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="diseno suizo + instrumentacion de laboratorio + papel prensa + orden frente a accidente"
                />
                <div>
                  <Button size="sm" onClick={suggest}>
                    <Dices className="size-3.5" aria-hidden="true" />
                    Proponer combinacion
                  </Button>
                </div>
              </div>
            </Field>

            <Field label="Descripcion" htmlFor="seed-description">
              <Input
                id="seed-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Rigor documental con densidad de informacion alta."
              />
            </Field>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-1 text-[0.8125rem] font-medium text-ink">
                Directrices: como se traduce la Seed a decisiones de diseno
              </legend>
              {DIRECTIVE_FIELDS.map((field) => (
                <Field key={field.key} label={field.label} htmlFor={`seed-${field.key}`}>
                  <Input
                    id={`seed-${field.key}`}
                    value={directives[field.key]}
                    onChange={(event) => setDirective(field.key, event.target.value)}
                    placeholder={field.placeholder}
                  />
                </Field>
              ))}
            </fieldset>

            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={submit}
                loading={submitting}
                disabled={name.trim().length < 2 || value.trim().length < 5}
              >
                Guardar Seed
              </Button>
              <Button onClick={() => setCreating(false)} disabled={submitting}>
                Cancelar
              </Button>
            </div>
          </PanelBody>
        ) : null}

        <ul className="divide-y divide-line">
          {[...own, ...presets].map((seed) => (
            <li key={seed.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    {seed.name}
                    {seed.isPreset ? (
                      <span title="Seed del catalogo, de solo lectura">
                        <Lock className="size-3 text-faint" aria-hidden="true" />
                        <span className="sr-only">Del catalogo</span>
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-accent">{seed.value}</p>
                  {seed.description ? <p className="mt-1 text-sm text-muted">{seed.description}</p> : null}
                </div>
                <div className="flex flex-none items-center gap-2">
                  <Badge>{seed.category}</Badge>
                  {!seed.isPreset ? (
                    <Button variant="danger" size="sm" onClick={() => remove(seed.id)}>
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Eliminar {seed.name}</span>
                    </Button>
                  ) : null}
                </div>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-accent">Ver directrices de diseno</summary>
                <dl className="mt-1.5 grid gap-2 border border-line bg-bg p-2.5 text-xs sm:grid-cols-2">
                  {DIRECTIVE_FIELDS.map((field) =>
                    seed.directives[field.key] ? (
                      <div key={field.key}>
                        <dt className="eyebrow">{field.label}</dt>
                        <dd className="mt-0.5 text-muted">{seed.directives[field.key]}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
