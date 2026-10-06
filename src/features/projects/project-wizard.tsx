'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Wand2 } from 'lucide-react';

import { Alert, Button, Field, Input, Panel, PanelBody, PanelHeader, Select, Textarea } from '@/components/ui';
import { TagInput } from '@/components/ui/tag-input';
import { cn } from '@/lib/utils';
import type { LandingType, Technology, Tone } from '@/types/domain';

/**
 * Asistente de creacion de proyecto.
 *
 * Aplica revelacion progresiva: tres pasos con pocas preguntas cada uno. Solo
 * el paso 1 y el paso 2 son obligatorios.
 *
 * No pregunta por estilo, colores, tipografia, secciones, caracteristicas,
 * beneficios, restricciones negativas ni restricciones tecnicas: eran decisiones
 * del prompt que chocaban con las tecnicas de diseno (p. ej. «Menos de 150 KB»
 * o «Un unico archivo HTML» contra la generacion de imagenes o el CDN de
 * Tailwind). La direccion visual y la estructura las decide quien redacta el
 * prompt (con la Seed si esta elegida) y las restricciones negativas son la
 * tecnica "Restricciones negativas" del Prompt Studio.
 */

const LANDING_TYPES: Array<{ value: LandingType; label: string }> = [
  { value: 'saas', label: 'SaaS / producto digital' },
  { value: 'product', label: 'Producto fisico' },
  { value: 'service', label: 'Servicio profesional' },
  { value: 'event', label: 'Evento' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'lead-generation', label: 'Captacion de leads' },
  { value: 'app-mobile', label: 'App movil' },
  { value: 'course', label: 'Formacion / curso' },
  { value: 'ecommerce', label: 'Ecommerce' },
  { value: 'nonprofit', label: 'ONG / causa' },
  { value: 'other', label: 'Otro' },
];

const TONES: Array<{ value: Tone; label: string }> = [
  { value: 'directo', label: 'Directo' },
  { value: 'tecnico', label: 'Tecnico' },
  { value: 'cercano', label: 'Cercano' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'institucional', label: 'Institucional' },
  { value: 'provocador', label: 'Provocador' },
  { value: 'sobrio', label: 'Sobrio' },
];

const STEPS = [
  { id: 1, title: '¿Que quieres crear?', hint: 'Lo basico del encargo' },
  { id: 2, title: '¿Para quien?', hint: 'Publico, objetivo y tono' },
  { id: 3, title: '¿Que tecnologia?', hint: 'Stack tecnologico' },
];

interface FormState {
  name: string;
  theme: string;
  description: string;
  landingType: LandingType;
  productOrService: string;
  targetAudience: string;
  primaryGoal: string;
  primaryCta: string;
  tone: Tone;
  keyMessage: string;
  technologyIds: string[];
  framework: string;
  libraries: string[];
}

const INITIAL: FormState = {
  name: '',
  theme: '',
  description: '',
  landingType: 'saas',
  productOrService: '',
  targetAudience: '',
  primaryGoal: '',
  primaryCta: '',
  tone: 'directo',
  keyMessage: '',
  technologyIds: ['html5', 'css3', 'javascript'],
  framework: '',
  libraries: [],
};

export function ProjectWizard({ technologies }: { technologies: Technology[] }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const stepErrors = useMemo(() => validateStep(step, form), [step, form]);
  const canContinue = stepErrors.length === 0;

  const goNext = () => {
    if (!canContinue) {
      setError(stepErrors[0] ?? null);
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, STEPS.length));
  };

  const goBack = () => {
    setError(null);
    setStep((current) => Math.max(current - 1, 1));
  };

  const submit = async () => {
    // Los pasos 1 y 2 son los unicos obligatorios: si falta algo, se vuelve alli.
    const stepOneErrors = validateStep(1, form);
    const stepTwoErrors = validateStep(2, form);
    if (stepOneErrors.length > 0 || stepTwoErrors.length > 0) {
      setError(stepOneErrors[0] ?? stepTwoErrors[0] ?? null);
      setStep(stepOneErrors.length > 0 ? 1 : 2);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          basics: {
            name: form.name,
            theme: form.theme || form.productOrService,
            description: form.description,
            landingType: form.landingType,
            targetAudience: form.targetAudience,
            primaryGoal: form.primaryGoal,
            productOrService: form.productOrService || form.name,
            primaryCta: form.primaryCta,
          },
          technical: {
            technologyIds: form.technologyIds,
            framework: form.framework || null,
            libraries: form.libraries,
          },
          content: {
            keyMessage: form.keyMessage,
            tone: form.tone,
          },
        }),
      });

      const payload = (await response.json()) as { data?: { id: string }; error?: { message: string } };

      if (!response.ok || !payload.data) {
        setError(payload.error?.message ?? 'No pudimos crear el proyecto.');
        setSubmitting(false);
        return;
      }

      router.push(`/projects/${payload.data.id}`);
      router.refresh();
    } catch {
      setError('No pudimos conectar con el servidor. Revisa tu conexion e intentalo de nuevo.');
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[210px_1fr]">
      {/* Progreso */}
      <nav aria-label="Pasos del asistente" className="lg:sticky lg:top-6 lg:self-start">
        <ol className="grid gap-1">
          {STEPS.map((item) => {
            const state = item.id === step ? 'current' : item.id < step ? 'done' : 'todo';
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => item.id < step && setStep(item.id)}
                  disabled={item.id > step}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 border px-2.5 py-2 text-left text-sm transition-colors',
                    state === 'current' && 'border-accent bg-accent-soft text-accent',
                    state === 'done' && 'border-line text-muted hover:bg-panel-2',
                    state === 'todo' && 'border-transparent text-faint',
                  )}
                >
                  <span className="mt-0.5 font-mono text-xs">
                    {state === 'done' ? <Check className="size-3.5" aria-hidden="true" /> : String(item.id).padStart(2, '0')}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium leading-tight">{item.title}</span>
                    <span className="block text-xs opacity-80">{item.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Panel>
          <PanelHeader
            eyebrow={`Paso ${step} de ${STEPS.length}`}
            title={STEPS[step - 1]?.title ?? ''}
            description={STEPS[step - 1]?.hint}
          />
          <PanelBody className="grid gap-4">
            {step === 1 ? <StepOne form={form} set={set} /> : null}
            {step === 2 ? <StepTwo form={form} set={set} /> : null}
            {step === 3 ? <StepThree form={form} set={set} technologies={technologies} /> : null}
          </PanelBody>
        </Panel>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" onClick={goBack} disabled={step === 1 || submitting}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Atras
          </Button>

          {step < STEPS.length ? (
            <Button type="button" variant="primary" onClick={goNext}>
              Continuar
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="button" variant="primary" onClick={submit} loading={submitting}>
              <Wand2 className="size-4" aria-hidden="true" />
              Crear proyecto
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type Setter = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

function StepOne({ form, set }: { form: FormState; set: Setter }) {
  return (
    <>
      <Field label="Nombre del proyecto" htmlFor="name" required>
        <Input
          id="name"
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          placeholder="Plataforma de inventario para talleres"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Producto o servicio" htmlFor="product" required hint="Que se vende exactamente.">
          <Input
            id="product"
            value={form.productOrService}
            onChange={(event) => set('productOrService', event.target.value)}
            placeholder="Software de gestion de piezas"
          />
        </Field>

        <Field label="Tipo de Landing Page" htmlFor="landingType">
          <Select
            id="landingType"
            value={form.landingType}
            onChange={(event) => set('landingType', event.target.value as LandingType)}
          >
            {LANDING_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Tema" htmlFor="theme" hint="En una linea: de que va esta pagina.">
        <Input
          id="theme"
          value={form.theme}
          onChange={(event) => set('theme', event.target.value)}
          placeholder="Control de stock para talleres mecanicos independientes"
        />
      </Field>

      <Field
        label="Descripcion"
        htmlFor="description"
        required
        hint="Cuanto mas concreto, menos generico sera el resultado."
      >
        <Textarea
          id="description"
          rows={4}
          value={form.description}
          onChange={(event) => set('description', event.target.value)}
          placeholder="Los talleres pequenos pierden horas buscando piezas que ya tienen. Esta herramienta lee los albaranes, mantiene el stock al dia y avisa antes de que falte algo."
        />
      </Field>
    </>
  );
}

function StepTwo({ form, set }: { form: FormState; set: Setter }) {
  return (
    <>
      <Field label="Publico objetivo" htmlFor="audience" required hint="Quien lee la pagina, no quien paga la factura.">
        <Input
          id="audience"
          value={form.targetAudience}
          onChange={(event) => set('targetAudience', event.target.value)}
          placeholder="jefes de taller de entre 3 y 15 empleados"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Objetivo principal" htmlFor="goal" required>
          <Input
            id="goal"
            value={form.primaryGoal}
            onChange={(event) => set('primaryGoal', event.target.value)}
            placeholder="conseguir pruebas gratuitas de 14 dias"
          />
        </Field>

        <Field label="CTA principal" htmlFor="cta" required hint="El texto exacto del boton.">
          <Input
            id="cta"
            value={form.primaryCta}
            onChange={(event) => set('primaryCta', event.target.value)}
            placeholder="Probar 14 dias"
          />
        </Field>
      </div>

      <Field label="Mensaje principal" htmlFor="keyMessage" hint="La frase que debe quedarse el visitante.">
        <Textarea
          id="keyMessage"
          rows={2}
          value={form.keyMessage}
          onChange={(event) => set('keyMessage', event.target.value)}
          placeholder="Deja de buscar piezas que ya tienes"
        />
      </Field>

      <Field label="Tono de comunicacion" htmlFor="tone">
        <Select id="tone" value={form.tone} onChange={(event) => set('tone', event.target.value as Tone)}>
          {TONES.map((tone) => (
            <option key={tone.value} value={tone.value}>
              {tone.label}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

function StepThree({
  form,
  set,
  technologies,
}: {
  form: FormState;
  set: Setter;
  technologies: Technology[];
}) {
  const toggle = (id: string) => {
    set(
      'technologyIds',
      form.technologyIds.includes(id)
        ? form.technologyIds.filter((item) => item !== id)
        : [...form.technologyIds, id],
    );
  };

  const selected = technologies.filter((tech) => form.technologyIds.includes(tech.id));
  const conflicts = detectConflicts(selected);

  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[0.8125rem] font-medium text-ink">Tecnologias</legend>
        <p className="mb-1 text-xs text-faint">
          Cada tecnologia aporta sus propias instrucciones al prompt. Puedes combinar varias.
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {technologies.map((tech) => {
            const checked = form.technologyIds.includes(tech.id);
            return (
              <label
                key={tech.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 border px-2.5 py-2 text-sm transition-colors',
                  checked ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel-2',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(tech.id)}
                  className="mt-0.5 size-3.5 flex-none accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">
                    {tech.name}
                    {tech.version ? <span className="ml-1 font-mono text-xs text-faint">{tech.version}</span> : null}
                  </span>
                  <span className="block text-xs text-muted">{tech.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {conflicts.length > 0 ? (
        <Alert tone="warn" title="Conflicto entre tecnologias">
          <ul className="list-disc space-y-0.5 pl-4">
            {conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
          El Prompt Composer resolvera el conflicto por prioridad y te lo indicara en el prompt final.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Framework principal" htmlFor="framework" hint="Opcional. Se anade al contexto del prompt.">
          <Input
            id="framework"
            value={form.framework}
            onChange={(event) => set('framework', event.target.value)}
            placeholder="Next.js App Router"
          />
        </Field>

        <Field label="Librerias adicionales" htmlFor="libraries">
          <TagInput
            id="libraries"
            value={form.libraries}
            onChange={(next) => set('libraries', next)}
            placeholder="Anade una libreria y pulsa Enter"
          />
        </Field>
      </div>
    </>
  );
}

function validateStep(step: number, form: FormState): string[] {
  const errors: string[] = [];

  if (step === 1) {
    if (form.name.trim().length < 2) errors.push('Escribe un nombre para el proyecto.');
    if (form.productOrService.trim().length < 2) errors.push('Indica el producto o servicio.');
    if (form.description.trim().length < 10) errors.push('La descripcion necesita al menos 10 caracteres.');
  }

  if (step === 2) {
    if (form.targetAudience.trim().length < 3) errors.push('Indica a quien va dirigida la pagina.');
    if (form.primaryGoal.trim().length < 3) errors.push('Indica el objetivo principal.');
    if (form.primaryCta.trim().length < 2) errors.push('Escribe el texto del CTA principal.');
  }

  return errors;
}

/** Aviso temprano en la UI; la resolucion real la hace el Prompt Composer. */
function detectConflicts(selected: Technology[]): string[] {
  const messages: string[] = [];
  const seen = new Set<string>();

  for (const tech of selected) {
    for (const otherSlug of tech.conflictsWith) {
      const other = selected.find((item) => item.slug === otherSlug || item.id === otherSlug);
      if (!other) continue;
      const key = [tech.slug, other.slug].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push(`${tech.name} y ${other.name} resuelven la misma capa y no deberian combinarse.`);
    }
  }

  return messages;
}
