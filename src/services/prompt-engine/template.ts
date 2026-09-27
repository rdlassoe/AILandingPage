/**
 * Motor de plantillas minimo para las PromptTemplate almacenadas.
 * Sustituye `{{variable}}` por su valor; las variables ausentes se
 * reemplazan por una cadena vacia en lugar de dejar el marcador visible.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => variables[name] ?? '');
}

/** Extrae los nombres de variable declarados en una plantilla. */
export function extractVariables(template: string): string[] {
  const names = new Set<string>();
  const pattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match = pattern.exec(template);
  while (match !== null) {
    if (match[1]) names.add(match[1]);
    match = pattern.exec(template);
  }
  return Array.from(names);
}
