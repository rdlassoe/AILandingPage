import { z } from 'zod';

import { PROVIDER_IDS } from '@/types/llm';

/**
 * Validacion de entrada.
 *
 * Todo lo que llega por HTTP pasa por aqui antes de tocar el DataStore o un
 * proveedor LLM. No se confia en la validacion del formulario del cliente.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const stringList = (max: number) => z.array(z.string().trim().min(1).max(400)).max(max).default([]);

export const providerIdSchema = z.enum(PROVIDER_IDS as unknown as [string, ...string[]]);

export const landingTypeSchema = z.enum([
  'saas',
  'product',
  'service',
  'event',
  'portfolio',
  'lead-generation',
  'app-mobile',
  'course',
  'ecommerce',
  'nonprofit',
  'other',
]);

export const toneSchema = z.enum([
  'directo',
  'tecnico',
  'cercano',
  'editorial',
  'institucional',
  'provocador',
  'sobrio',
]);

export const projectStatusSchema = z.enum(['draft', 'defined', 'generated', 'archived']);
export const landingStatusSchema = z.enum(['draft', 'private', 'public', 'featured']);

export const projectBasicsSchema = z.object({
  name: trimmed(120).min(2, 'El nombre debe tener al menos 2 caracteres.'),
  theme: trimmed(160).min(2, 'Describe el tema en pocas palabras.'),
  description: trimmed(1200).min(10, 'Describe el proyecto con algo mas de detalle.'),
  landingType: landingTypeSchema,
  targetAudience: trimmed(400).min(3, 'Indica a quien va dirigida la pagina.'),
  primaryGoal: trimmed(300).min(3, 'Indica el objetivo principal.'),
  productOrService: trimmed(300).min(2, 'Indica el producto o servicio.'),
  primaryCta: trimmed(120).min(2, 'Escribe el texto del CTA principal.'),
});

export const projectVisualSchema = z.object({
  style: trimmed(300).default(''),
  colors: stringList(12),
  typography: trimmed(200).default(''),
  sophistication: z.number().int().min(1).max(5).default(3),
  references: stringList(10),
  avoid: stringList(20),
});

export const projectTechnicalSchema = z.object({
  technologyIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  framework: trimmed(80).nullable().default(null),
  libraries: stringList(12),
  constraints: stringList(15),
});

export const projectContentSchema = z.object({
  sections: stringList(16),
  features: stringList(15),
  benefits: stringList(15),
  keyMessage: trimmed(400).default(''),
  tone: toneSchema.default('directo'),
});

export const createProjectSchema = z.object({
  basics: projectBasicsSchema,
  // El asistente ya no pregunta por el estilo (3 pasos): `visual` puede omitirse.
  visual: z.preprocess((value) => value ?? {}, projectVisualSchema),
  technical: projectTechnicalSchema,
  content: projectContentSchema,
  negativeConstraints: stringList(30),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  status: projectStatusSchema.optional(),
});

export const generationConfigSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(256).max(200_000).optional(),
  topP: z.number().min(0).max(1).optional(),
});

export const generateLandingSchema = z.object({
  projectId: z.string().trim().min(1),
  promptContent: z.string().max(200_000).optional(),
  systemInstruction: z.string().max(20_000).optional(),
  promptId: z.string().trim().min(1).optional(),
  promptVersionId: z.string().trim().min(1).optional(),
  providerId: providerIdSchema.optional(),
  model: z.string().trim().max(120).optional(),
  config: generationConfigSchema.optional(),
  label: trimmed(80).optional(),
  allowCache: z.boolean().optional(),
});

export const buildPromptSchema = z.object({
  projectId: z.string().trim().min(1),
  technologyIds: z.array(z.string().trim().min(1)).max(12).optional(),
  negativeConstraints: stringList(30).optional(),
  designTechniques: z.array(z.string().trim().min(1)).max(20).optional(),
});

export const composePromptSchema = z.object({
  projectId: z.string().trim().min(1),
  promptId: z.string().trim().min(1).optional(),
  providerId: providerIdSchema.optional(),
  model: z.string().trim().max(120).optional(),
  designTechniques: z.array(z.string().trim().min(1)).max(20).optional(),
});

export const critiqueSchema = z.object({
  landingPageId: z.string().trim().min(1),
  providerId: providerIdSchema.optional(),
  model: z.string().trim().max(120).optional(),
});

export const refineSchema = z.object({
  landingPageId: z.string().trim().min(1),
  reviewId: z.string().trim().min(1).optional(),
  acceptedSuggestionIds: z.array(z.string().trim().min(1)).max(30).default([]),
  extraInstructions: z.string().trim().max(4_000).optional(),
  providerId: providerIdSchema.optional(),
  model: z.string().trim().max(120).optional(),
});

export const variationSchema = z.object({
  landingPageId: z.string().trim().min(1),
  strategy: z.enum([
    'same-structure-new-style',
    'same-brand-new-composition',
    'same-content-new-seed',
    'same-structure-new-cta',
    'minimal',
    'editorial',
    'experimental',
  ]),
  notes: z.string().trim().max(2_000).optional(),
  providerId: providerIdSchema.optional(),
  model: z.string().trim().max(120).optional(),
});

export const discoverSchema = z.object({
  projectId: z.string().trim().min(1),
  providerId: providerIdSchema.optional(),
  model: z.string().trim().max(120).optional(),
});

export const updateLandingSchema = z.object({
  name: trimmed(140).optional(),
  description: trimmed(600).optional(),
  status: landingStatusSchema.optional(),
  category: trimmed(80).nullable().optional(),
});

/** El HTML se guarda por su propia ruta: `PUT /api/landings/[id]/html`. */
export const saveLandingHtmlSchema = z.object({
  // Sin `.trim()`: el texto del editor se guarda tal cual lo escribio el usuario.
  html: z.string().max(4_000_000),
  expectedVersion: z.number().int().min(1).optional(),
});

export const createTechnologySchema = z.object({
  name: trimmed(80).min(2),
  slug: trimmed(80).optional(),
  description: trimmed(600).default(''),
  category: z.enum(['language', 'markup', 'styling', 'framework', 'library', 'tooling', 'icons']),
  version: trimmed(40).nullable().default(null),
  promptInstructions: z.string().trim().min(10, 'Escribe las instrucciones que se inyectaran en el prompt.').max(8_000),
  constraints: stringList(20),
  outputRequirements: stringList(20),
  conflictsWith: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  priority: z.number().int().min(1).max(100).default(20),
  selfContainedPreview: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(500),
});

export const updateProfileSchema = z.object({
  displayName: trimmed(80).optional(),
  preferredProvider: providerIdSchema.optional(),
  preferredModel: z.string().trim().max(120).nullable().optional(),
});

export const testProviderSchema = z.object({
  providerId: providerIdSchema,
});

/** Convierte los errores de Zod en un mensaje legible para el usuario. */
export function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Los datos enviados no son validos.';
  const path = first.path.filter((segment) => typeof segment === 'string').join(' › ');
  return path ? `${path}: ${first.message}` : first.message;
}
