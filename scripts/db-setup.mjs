/**
 * Aplica el esquema de AI Landing Studio contra una base de Supabase.
 *
 *   npm run db:check    comprueba que esta todo en su sitio, sin escribir nada
 *   npm run db:setup    ejecuta schema.sql, policies.sql y seed.sql en orden
 *
 * Necesita `SUPABASE_DB_URL` en .env.local. La encuentras en el panel de
 * Supabase: Project Settings -> Database -> Connection string -> URI
 * (usa la cadena del *Session pooler* o la *Direct connection*; ambas valen).
 *
 * Los tres archivos SQL son idempotentes, asi que volver a ejecutarlos sobre
 * una base ya preparada no rompe nada: actualiza el catalogo y deja el resto
 * como esta. Este script NUNCA borra datos.
 */
import { readFileSync } from 'node:fs';
import { promises as dns } from 'node:dns';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  { name: 'schema.sql', label: 'tablas, tipos, indices y triggers' },
  { name: 'policies.sql', label: 'Row Level Security' },
  { name: 'seed.sql', label: 'catalogo inicial' },
];

/** Lo que `--check` espera encontrar. */
const EXPECTED_TABLES = [
  'profiles',
  'technologies',
  'prompt_templates',
  'landing_categories',
  'projects',
  'project_technologies',
  'prompts',
  'prompt_versions',
  'landing_pages',
  'landing_versions',
  'generations',
  'generation_reviews',
  'landing_images',
  'llm_providers',
  'llm_models',
];

const EXPECTED_ENUMS = [
  'provider_id',
  'technology_category',
  'project_status',
  'landing_status',
  'generation_status',
  'generation_kind',
  'prompt_template_kind',
];

const checkOnly = process.argv.includes('--check');

const c = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  bold: '\u001b[1m',
};

const ok = (text) => console.log(`${c.green}OK${c.reset}    ${text}`);
const warn = (text) => console.log(`${c.yellow}AVISO${c.reset} ${text}`);
const fail = (text) => console.log(`${c.red}FALTA${c.reset} ${text}`);
const info = (text) => console.log(`${c.dim}      ${text}${c.reset}`);

function readConnectionString() {
  const raw = (process.env.SUPABASE_DB_URL ?? '').trim();

  if (!raw) {
    console.error(`${c.red}Falta SUPABASE_DB_URL.${c.reset}

Anadela a tu archivo .env.local:

  SUPABASE_DB_URL=postgresql://postgres.xxxx:TU_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres

Donde encontrarla:
  Supabase -> tu proyecto -> Project Settings -> Database -> Connection string -> URI

Notas:
  - Sustituye [YOUR-PASSWORD] por la contrasena de la base de datos (no es la
    clave anon ni la service role).
  - Si la contrasena tiene caracteres especiales, codificalos para URL
    (@ -> %40, # -> %23, etc.).
  - SUPABASE_DB_URL solo la usa este script. La aplicacion no la necesita.`);
    process.exit(1);
  }

  if (raw.includes('YOUR-PASSWORD')) {
    console.error(
      `${c.red}SUPABASE_DB_URL todavia tiene el marcador YOUR-PASSWORD.${c.reset}\n` +
        'Sustituyelo por la contrasena real de la base de datos.',
    );
    process.exit(1);
  }

  // Error muy frecuente: conservar los corchetes de la plantilla de Supabase.
  // En `postgresql://postgres:[YOUR-PASSWORD]@host/postgres` los corchetes
  // delimitan el hueco, no forman parte de la contrasena.
  let password = '';
  try {
    password = decodeURIComponent(new URL(raw).password);
  } catch {
    // Cadena no parseable: lo dira el intento de conexion.
  }

  if (password.startsWith('[') && password.endsWith(']')) {
    console.error(`${c.red}La contrasena esta entre corchetes.${c.reset}

En la plantilla de Supabase los corchetes solo delimitan el hueco:

  postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres
                        ^             ^   estos corchetes se quitan

Deja solo la contrasena, sin [ ni ].`);
    process.exit(1);
  }

  return raw;
}

async function connect(connectionString) {
  const client = new pg.Client({
    connectionString,
    // Supabase exige TLS; su certificado no esta en el almacen por defecto de Node.
    ssl: { rejectUnauthorized: false },
    // Si la cadena es incorrecta, mejor fallar pronto que colgarse.
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(`${c.red}No se pudo conectar a la base de datos.${c.reset}`);
    console.error(`  ${error.message}`);

    const diagnosis = await diagnoseHost(connectionString);
    if (diagnosis) {
      console.error(`
${diagnosis}`);
    } else {
      console.error(`
Comprueba:
  - que la contrasena de SUPABASE_DB_URL es correcta y esta codificada para URL;
  - que el proyecto de Supabase no esta pausado;
  - que tu red permite salir por el puerto 5432.`);
    }
    process.exit(1);
  }

  return client;
}

/**
 * Explica el fallo de conexion mas comun y silencioso de Supabase.
 *
 * El host de conexion directa `db.<ref>.supabase.co` solo publica registro
 * AAAA: es accesible unicamente por IPv6. En una red sin IPv6 el fallo llega
 * como ENOTFOUND, que parece un error de tipografia en el host y no lo es.
 * La solucion es el pooler, que si tiene IPv4.
 */
async function diagnoseHost(connectionString) {
  let host;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return null;
  }

  const has = async (kind) => {
    try {
      return (await dns.resolve(host, kind)).length > 0;
    } catch {
      return false;
    }
  };

  const [ipv4, ipv6] = await Promise.all([has('A'), has('AAAA')]);

  if (!ipv4 && ipv6 && /^db\./.test(host)) {
    const ref = host.replace(/^db\./, '').replace(/\.supabase\.co$/, '');
    return `${c.yellow}Causa probable: ese host solo tiene direccion IPv6 y tu red no la alcanza.${c.reset}

  ${host}
    IPv4: no publicado
    IPv6: si

  Usa la cadena del POOLER, que si tiene IPv4. En el panel de Supabase:
  Project Settings -> Database -> Connection string -> selecciona "Session pooler".

  Tiene esta forma (fijate en el usuario, lleva el ref del proyecto):

    SUPABASE_DB_URL=postgresql://postgres.${ref}:TU_PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres`;
  }

  if (!ipv4 && !ipv6) {
    return `${c.yellow}El host ${host} no resuelve. Revisa que este bien escrito y que el proyecto exista.${c.reset}`;
  }

  return null;
}

async function inspect(client) {
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [EXPECTED_TABLES],
  );

  const { rows: enums } = await client.query(
    `select t.typname from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e' and t.typname = any($1::text[])`,
    [EXPECTED_ENUMS],
  );

  const { rows: rls } = await client.query(
    `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1::text[])`,
    [EXPECTED_TABLES],
  );

  const { rows: policies } = await client.query(
    `select count(*)::int as total from pg_policies where schemaname = 'public'`,
  );

  // El bucket de imagenes vive en el esquema `storage`, que solo existe en Supabase.
  let imagesBucket = null;
  try {
    const { rows: buckets } = await client.query(
      `select public from storage.buckets where id = 'landing-images'`,
    );
    imagesBucket = buckets[0] ? { public: buckets[0].public === true } : { missing: true };
  } catch {
    imagesBucket = null;
  }

  // La columna donde cada usuario guarda sus credenciales (cifradas) desde Ajustes.
  const { rows: credentialsColumn } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'credentials'`,
  );

  const counts = {};
  const presentTables = new Set(tables.map((r) => r.table_name));
  for (const table of ['technologies', 'prompt_templates', 'llm_models']) {
    if (!presentTables.has(table)) continue;
    const { rows } = await client.query(`select count(*)::int as total from ${table}`);
    counts[table] = rows[0].total;
  }

  return {
    tables: presentTables,
    enums: new Set(enums.map((r) => r.typname)),
    rlsDisabled: rls.filter((r) => !r.relrowsecurity).map((r) => r.relname),
    policies: policies[0].total,
    imagesBucket,
    credentialsColumn: credentialsColumn.length > 0,
    counts,
  };
}

function report(state) {
  console.log(`\n${c.bold}Estado de la base de datos${c.reset}\n`);

  const missingTables = EXPECTED_TABLES.filter((t) => !state.tables.has(t));
  const missingEnums = EXPECTED_ENUMS.filter((e) => !state.enums.has(e));

  if (missingTables.length === 0) {
    ok(`${EXPECTED_TABLES.length} tablas presentes`);
  } else {
    fail(`${missingTables.length} tablas: ${missingTables.join(', ')}`);
  }

  if (missingEnums.length === 0) {
    ok(`${EXPECTED_ENUMS.length} tipos enumerados presentes`);
  } else {
    fail(`${missingEnums.length} tipos: ${missingEnums.join(', ')}`);
  }

  if (state.rlsDisabled.length === 0 && missingTables.length === 0) {
    ok('Row Level Security activo en todas las tablas');
  } else if (state.rlsDisabled.length > 0) {
    fail(`RLS desactivado en: ${state.rlsDisabled.join(', ')}`);
  }

  if (state.policies >= 23) {
    ok(`${state.policies} politicas RLS definidas`);
  } else if (state.policies > 0) {
    warn(`${state.policies} politicas RLS (se esperaban 23 o mas)`);
  } else {
    fail('Sin politicas RLS');
  }

  // No es fatal: sin bucket solo falla la tecnica "Generacion de imagenes".
  if (state.imagesBucket?.missing) {
    warn('Falta el bucket `landing-images` de Storage: las imagenes generadas no se podran guardar (vuelve a ejecutar db:setup o creelo, publico, en el panel de Supabase)');
  } else if (state.imagesBucket && state.imagesBucket.public === false) {
    warn('El bucket `landing-images` no es publico: la vista previa (iframe sandbox sin cookies) no podra mostrar las imagenes');
  } else if (state.imagesBucket) {
    ok('Bucket publico `landing-images` presente');
  }

  // No es fatal: sin la columna solo falla guardar claves desde Ajustes (las del servidor siguen valiendo).
  if (state.tables.has('profiles') && state.credentialsColumn === false) {
    warn('Falta la columna `profiles.credentials`: no se podran guardar claves API desde Ajustes (ejecuta db:setup)');
  } else if (state.credentialsColumn) {
    ok('Columna `profiles.credentials` presente (claves cifradas desde Ajustes)');
  }

  const seeded =
    (state.counts.technologies ?? 0) > 0 &&
    (state.counts.prompt_templates ?? 0) > 0;

  if (seeded) {
    ok(
      `Catalogo cargado: ${state.counts.technologies} tecnologias, ` +
        `${state.counts.prompt_templates} plantillas, ${state.counts.llm_models ?? 0} modelos`,
    );
  } else if (missingTables.length === 0) {
    fail('El catalogo esta vacio: falta ejecutar seed.sql');
  }

  const healthy =
    missingTables.length === 0 && missingEnums.length === 0 && state.rlsDisabled.length === 0 && seeded;

  console.log();
  if (healthy) {
    console.log(`${c.green}${c.bold}La base esta lista.${c.reset}`);
    info('Rellena NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY y reinicia el servidor.');
  } else {
    console.log(`${c.yellow}${c.bold}Falta preparar la base.${c.reset}`);
    info('Ejecuta:  npm run db:setup');
  }

  return healthy;
}

async function apply(client) {
  console.log(`\n${c.bold}Aplicando el esquema${c.reset}\n`);

  for (const file of FILES) {
    const sql = readFileSync(join(root, 'supabase', file.name), 'utf8');
    const started = Date.now();
    process.stdout.write(`      ${file.name.padEnd(14)} ${c.dim}${file.label}${c.reset} ... `);

    try {
      // El archivo entero va en una sola consulta: el protocolo simple admite
      // varias sentencias y las ejecuta en una transaccion implicita, asi que
      // si una falla no queda nada a medias. Ademas respeta los bloques $$.
      await client.query(sql);
      console.log(`${c.green}hecho${c.reset} ${c.dim}(${Date.now() - started} ms)${c.reset}`);
    } catch (error) {
      console.log(`${c.red}error${c.reset}`);
      console.error(`\n${c.red}${file.name} fallo y se revirtio por completo.${c.reset}`);
      console.error(`  ${error.message}`);
      if (error.position) {
        const upto = sql.slice(0, Number(error.position));
        const line = upto.split('\n').length;
        console.error(`  ${c.dim}alrededor de la linea ${line} de ${file.name}${c.reset}`);
      }
      if (error.code === '42501') {
        console.error(
          `\n  El usuario de la conexion no tiene permisos suficientes.\n` +
            `  Usa la cadena de conexion del usuario 'postgres', no la de un rol limitado.`,
        );
      }
      await client.end();
      process.exit(1);
    }
  }
}

const connectionString = readConnectionString();
const client = await connect(connectionString);

const host = (() => {
  try {
    return new URL(connectionString).host;
  } catch {
    return 'desconocido';
  }
})();

console.log(`${c.dim}Conectado a ${host}${c.reset}`);

if (checkOnly) {
  const healthy = report(await inspect(client));
  await client.end();
  process.exit(healthy ? 0 : 1);
}

const before = await inspect(client);
if (before.tables.size > 0) {
  info(`Ya existen ${before.tables.size} de ${EXPECTED_TABLES.length} tablas. Los scripts son idempotentes.`);
}

await apply(client);
const healthy = report(await inspect(client));

await client.end();
process.exit(healthy ? 0 : 1);
