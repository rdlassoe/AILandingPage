/**
 * Valida el esquema, las politicas RLS y el contrato de columnas contra la
 * base de Supabase real.
 *
 *   npm run verify:supabase
 *
 * Todo ocurre dentro de UNA transaccion que termina en ROLLBACK: no se crea
 * ni se modifica nada de forma permanente, ni siquiera los usuarios de prueba.
 *
 * Que comprueba, y por que:
 *  1. Privilegios del rol `authenticated`. Sin GRANT, la aplicacion fallaria
 *     con "permission denied" en cada consulta aunque RLS este perfecta.
 *  2. El trigger que crea el perfil al registrarse.
 *  3. Contrato de columnas: cada nombre que emiten los mappers de
 *     `supabase-mappers.ts` existe en su tabla. Estan escritos a mano, y una
 *     errata solo se nota en produccion.
 *  4. Ida y vuelta de los bloques jsonb del proyecto.
 *  5. Aislamiento por RLS entre dos cuentas, incluidas las excepciones
 *     deliberadas (landings publicas, catalogo de solo lectura).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const c = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  bold: '\u001b[1m',
};

let failures = 0;
const ok = (label, extra = '') =>
  console.log(`${c.green}OK  ${c.reset} ${label}${extra ? `  ${c.dim}${extra}${c.reset}` : ''}`);
const bad = (label, extra = '') => {
  failures += 1;
  console.log(`${c.red}FALLA${c.reset} ${label}${extra ? `  ${extra}` : ''}`);
};
const check = (condition, label, extra = '') => (condition ? ok(label, extra) : bad(label, extra));
const section = (title) => console.log(`\n${c.bold}${title}${c.reset}`);

/* ---------------------------------------------------------------- conexion */

const connectionString = (process.env.SUPABASE_DB_URL ?? '').trim();
if (!connectionString) {
  console.error(`${c.red}Falta SUPABASE_DB_URL en .env.local.${c.reset}`);
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

await client.connect();
console.log(`${c.dim}Conectado a ${new URL(connectionString).host}${c.reset}`);

const q = async (sql, params) => (await client.query(sql, params)).rows;

/**
 * Ejecuta como usuario autenticado concreto, con RLS activa.
 *
 * Cada consulta va en su propio SAVEPOINT: en PostgreSQL, un error deja la
 * transaccion abortada y todo lo posterior falla con 25P02. Como aqui se
 * comprueban a proposito operaciones que DEBEN fallar, sin savepoints el
 * arnes se autodestruiria en la primera de ellas.
 */
let savepointSeq = 0;

const runAs = async (userId, sql, params) => {
  const sp = `sp${(savepointSeq += 1)}`;
  await client.query(`savepoint ${sp}`);
  try {
    await client.query(`set local role authenticated`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    const rows = (await client.query(sql, params)).rows;
    await client.query(`reset role`);
    await client.query(`release savepoint ${sp}`);
    return { rows, error: null };
  } catch (error) {
    await client.query(`rollback to savepoint ${sp}`);
    await client.query(`reset role`);
    return { rows: [], error: error.code ?? 'error' };
  }
};

const asUser = async (userId, sql, params) => {
  const { rows, error } = await runAs(userId, sql, params);
  if (error) throw Object.assign(new Error(`SQL fallo con ${error}`), { code: error });
  return rows;
};

/** Igual, pero se espera que falle: devuelve el codigo de error, o null si paso. */
const asUserExpectingError = async (userId, sql, params) => {
  const { error } = await runAs(userId, sql, params);
  return error;
};

/**
 * Igualdad profunda ignorando el orden de las claves.
 *
 * PostgreSQL normaliza el orden de las claves al almacenar jsonb, asi que
 * comparar con JSON.stringify da falsos negativos. Lo que importa es que
 * ningun valor se pierda ni se transforme.
 */
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEqual(a[k], b[k]));
  }
  return false;
};

const userA = randomUUID();
const userB = randomUUID();

await client.query('begin');

try {
  /* ------------------------------------------------------- 1. privilegios */

  section('1. Privilegios del rol authenticated');

  const grants = await q(
    `select table_name, string_agg(distinct privilege_type, ',' order by privilege_type) as privs
       from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
      group by table_name order by table_name`,
  );
  const granted = new Map(grants.map((r) => [r.table_name, r.privs]));
  const needed = ['projects', 'prompts', 'prompt_versions', 'landing_pages', 'landing_versions', 'generations', 'generation_reviews', 'profiles', 'technologies', 'seed_strings', 'project_technologies'];
  const missing = needed.filter((t) => !(granted.get(t) ?? '').includes('SELECT'));
  check(
    missing.length === 0,
    'El rol authenticated tiene privilegios sobre las tablas',
    missing.length ? `sin SELECT: ${missing.join(', ')}` : `${granted.size} tablas`,
  );

  /* ------------------------------------------------- 2. trigger de perfil */

  section('2. Alta automatica de perfil');

  await q(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, '{"display_name":"Cuenta A"}'::jsonb), ($3, $4, '{"display_name":"Cuenta B"}'::jsonb)`,
    [userA, 'verif-a@test.local', userB, 'verif-b@test.local'],
  );

  const profiles = await q(`select id, email, display_name, preferred_provider from profiles where id = any($1::uuid[])`, [[userA, userB]]);
  check(profiles.length === 2, 'El trigger on_auth_user_created creo los dos perfiles', `${profiles.length}/2`);
  check(
    profiles.every((p) => p.display_name && p.preferred_provider === 'mock'),
    'El perfil toma display_name de los metadatos y proveedor por defecto',
    profiles.map((p) => p.display_name).join(', '),
  );

  /* ------------------------------------------ 3. contrato de columnas */

  section('3. Contrato de columnas de los mappers');

  const mapperSource = readFileSync(join(root, 'src/lib/data/supabase-mappers.ts'), 'utf8');
  const mapperTables = {
    fromTechnology: 'technologies',
    fromSeed: 'seed_strings',
    fromProject: 'projects',
    fromPrompt: 'prompts',
    fromPromptVersion: 'prompt_versions',
    fromGeneration: 'generations',
    fromLandingPage: 'landing_pages',
    fromLandingVersion: 'landing_versions',
    fromReview: 'generation_reviews',
  };

  const columnsOf = async (table) =>
    new Set((await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [table])).map((r) => r.column_name));

  let contractErrors = 0;
  for (const [fn, table] of Object.entries(mapperTables)) {
    const start = mapperSource.indexOf(`export const ${fn} =`);
    if (start === -1) {
      bad(`No se encontro el mapper ${fn}`);
      continue;
    }
    const body = mapperSource.slice(start, mapperSource.indexOf('});', start));
    const emitted = [...body.matchAll(/^\s{2}([a-z_][a-z0-9_]*):/gm)].map((m) => m[1]);
    const actual = await columnsOf(table);
    const unknown = emitted.filter((col) => !actual.has(col));
    if (unknown.length > 0) {
      contractErrors += 1;
      bad(`${fn} -> ${table}`, `columnas inexistentes: ${unknown.join(', ')}`);
    }
  }
  check(contractErrors === 0, 'Todos los mappers escriben columnas que existen', `${Object.keys(mapperTables).length} mappers`);

  /* ------------------------------------------- 4. ida y vuelta del proyecto */

  section('4. Ida y vuelta de los bloques jsonb');

  const basics = {
    name: 'Proyecto de verificacion',
    theme: 'validacion del almacen',
    description: 'Comprueba que los bloques jsonb sobreviven al viaje de ida y vuelta.',
    landingType: 'saas',
    targetAudience: 'equipos de producto',
    primaryGoal: 'validar el DataStore',
    productOrService: 'AI Landing Studio',
    primaryCta: 'Probar',
  };
  const visual = { style: 'sobrio', colors: ['#111111', '#d0342c'], typography: 'grotesca', sophistication: 4, references: ['a', 'b'], avoid: ['stock'] };
  const technical = { technologyIds: ['html5', 'css3', 'lucide'], framework: null, libraries: [], constraints: ['sin CDN'] };
  const content = { sections: ['Hero', 'FAQ'], features: ['f1'], benefits: ['b1'], keyMessage: 'mensaje', tone: 'directo' };

  const [project] = await asUser(
    userA,
    `insert into projects (owner_id, status, basics, visual, technical, content,
                           seed_string_id, seed_string_value, negative_constraints)
     values ($1,'draft',$2,$3,$4,$5,$6,$7,$8) returning *`,
    [userA, basics, visual, technical, content, 'seed-swiss-editorial', 'diseno suizo + retícula', ['sin degradados']],
  );

  check(!!project?.id, 'INSERT de proyecto como usuario autenticado');
  const blocks = [
    ['basics', project.basics, basics],
    ['visual', project.visual, visual],
    ['technical', project.technical, technical],
    ['content', project.content, content],
  ];
  const differing = blocks.filter(([, got, want]) => !deepEqual(got, want)).map(([name]) => name);
  check(
    differing.length === 0,
    'Los cuatro bloques jsonb vuelven con los mismos valores',
    differing.length ? `difieren: ${differing.join(', ')}` : 'jsonb reordena claves, no valores',
  );
  check(
    Array.isArray(project.negative_constraints) && project.negative_constraints[0] === 'sin degradados',
    'Las restricciones negativas vuelven como text[]',
  );
  check(project.seed_string_id === 'seed-swiss-editorial', 'La FK a seed_strings acepta un id del catalogo');

  // Indice relacional del stack
  await asUser(
    userA,
    `insert into project_technologies (project_id, technology_id, position)
     values ($1,'html5',0), ($1,'css3',1), ($1,'lucide',2)`,
    [project.id],
  );
  const [{ n: techCount }] = await asUser(userA, `select count(*)::int as n from project_technologies where project_id=$1`, [project.id]);
  check(techCount === 3, 'project_technologies indexa el stack', `${techCount} filas`);

  // Indice sobre basics->>'name' usado por la busqueda
  const found = await asUser(userA, `select id from projects where basics->>'name' ilike $1`, ['%verificacion%']);
  check(found.length === 1, 'Busqueda por nombre dentro del jsonb');

  /* -------------------------------- 5. cadena prompt -> landing -> version */

  section('5. Cadena de trazabilidad');

  const [prompt] = await asUser(
    userA,
    `insert into prompts (owner_id, project_id, name, description, current_version, technology_ids, tags)
     values ($1,$2,'Prompt de verificacion','',0,array['html5','css3']::text[],array['saas']::text[]) returning *`,
    [userA, project.id],
  );
  const [version] = await asUser(
    userA,
    `insert into prompt_versions (prompt_id, owner_id, version, content, system_instruction, sections,
                                  technology_ids, seed_string_value, negative_constraints, conflicts,
                                  provider_id, model, config, change_note)
     values ($1,$2,1,'## ROLE...','sistema','[{"id":"ROLE","title":"ROLE","body":"x"}]'::jsonb,
             array['html5']::text[],'seed',array['sin degradados']::text[],'[]'::jsonb,
             'gemini','gemini-flash-latest','{"temperature":0.8}'::jsonb,'inicial') returning *`,
    [prompt.id, userA],
  );
  check(!!version?.id && version.version === 1, 'prompt_versions con sections jsonb y provider_id enum');

  const [generation] = await asUser(
    userA,
    `insert into generations (owner_id, project_id, prompt_id, prompt_version_id, kind, provider_id,
                              model, status, is_mock, latency_ms, input_tokens, output_tokens, warnings, cache_key)
     values ($1,$2,$3,$4,'landing','gemini','gemini-flash-latest','success',false,1234,100,200,
             array['aviso']::text[],'abc123') returning *`,
    [userA, project.id, prompt.id, version.id],
  );
  const [landing] = await asUser(
    userA,
    `insert into landing_pages (owner_id, project_id, prompt_id, prompt_version_id, generation_id,
                                name, description, html, technology_ids, provider_id, model, is_mock,
                                status, category, current_version, metadata)
     values ($1,$2,$3,$4,$5,'Landing de verificacion','desc','<!DOCTYPE html><html lang="es"></html>',
             array['html5']::text[],'gemini','gemini-flash-latest',false,'private','saas',1,
             '{"sections":["hero"],"sizeBytes":42,"hasScript":false,"hasStyle":true,"criticScore":null,"seedStringValue":"seed"}'::jsonb)
     returning *`,
    [userA, project.id, prompt.id, version.id, generation.id],
  );
  await asUser(
    userA,
    `insert into landing_versions (landing_page_id, owner_id, version, html, label, generation_id, prompt_version_id)
     values ($1,$2,1,'<!DOCTYPE html>','inicial',$3,$4)`,
    [landing.id, userA, generation.id, version.id],
  );
  await asUser(
    userA,
    `insert into generation_reviews (owner_id, generation_id, landing_page_id, issues, suggestions,
                                     priority, scores, refinement_prompt, provider_id, model, is_mock)
     values ($1,$2,$3,'[{"id":"issue-1"}]'::jsonb,'[{"id":"sug-1"}]'::jsonb,array['issue-1']::text[],
             '{"overall":80}'::jsonb,'corrige','gemini','gemini-flash-latest',false)`,
    [userA, generation.id, landing.id],
  );

  const [chain] = await asUser(
    userA,
    `select lp.id, lp.prompt_version_id, pv.prompt_id, p.project_id
       from landing_pages lp
       join prompt_versions pv on pv.id = lp.prompt_version_id
       join prompts p on p.id = pv.prompt_id
      where lp.id = $1`,
    [landing.id],
  );
  check(
    chain?.project_id === project.id,
    'landing -> prompt_version -> prompt -> project se resuelve entera',
  );

  /* ----------------------------------------------------- 6. aislamiento RLS */

  section('6. Aislamiento por Row Level Security');

  const bProjects = await asUser(userB, `select id from projects`);
  check(bProjects.length === 0, 'La cuenta B no ve los proyectos de A', `${bProjects.length} filas`);

  const bLandings = await asUser(userB, `select id from landing_pages`);
  check(bLandings.length === 0, 'La cuenta B no ve la landing privada de A', `${bLandings.length} filas`);

  const bUpdate = await asUser(userB, `update projects set status='archived' where id=$1 returning id`, [project.id]);
  check(bUpdate.length === 0, 'La cuenta B no puede modificar el proyecto de A');

  const spoof = await asUserExpectingError(
    userB,
    `insert into projects (owner_id, basics) values ($1,'{}'::jsonb)`,
    [userA],
  );
  check(spoof !== null, 'La cuenta B no puede crear filas a nombre de A', spoof ? `rechazado (${spoof})` : 'SE PERMITIO');

  const bGenerations = await asUser(userB, `select id from generations`);
  check(bGenerations.length === 0, 'La cuenta B no ve las generaciones de A');

  const bReviews = await asUser(userB, `select id from generation_reviews`);
  check(bReviews.length === 0, 'La cuenta B no ve las auditorias de A');

  /* --------------------------------------- 7. excepciones deliberadas */

  section('7. Excepciones deliberadas');

  const bTech = await asUser(userB, `select id from technologies where owner_id is null`);
  check(bTech.length >= 11, 'El catalogo de tecnologias es legible por cualquier autenticado', `${bTech.length} filas`);

  const catalogWrite = await asUser(userB, `update technologies set name='hackeada' where id='html5' returning id`);
  check(catalogWrite.length === 0, 'El catalogo no se puede modificar desde la aplicacion');

  const catalogInsert = await asUserExpectingError(
    userB,
    `insert into technologies (id, slug, name, category, prompt_instructions, owner_id)
     values ('x','x','x','library','x', null)`,
  );
  check(catalogInsert !== null, 'No se pueden anadir tecnologias al catalogo comun', catalogInsert ? `rechazado (${catalogInsert})` : 'SE PERMITIO');

  const bSeeds = await asUser(userB, `select id from seed_strings where is_preset`);
  check(bSeeds.length >= 11, 'Las Seed Strings del catalogo son legibles', `${bSeeds.length} filas`);

  const bTemplates = await asUser(userB, `select key from prompt_templates`);
  check(bTemplates.length >= 9, 'Las plantillas de prompt son legibles', `${bTemplates.length} filas`);

  // Landing publica
  await asUser(userA, `update landing_pages set status='public' where id=$1`, [landing.id]);
  const bPublic = await asUser(userB, `select id, status from landing_pages`);
  check(bPublic.length === 1, 'Una landing publica si es visible para otra cuenta');

  const bVersions = await asUser(userB, `select id from landing_versions`);
  check(bVersions.length === 0, 'El historial de versiones sigue siendo privado aunque la pagina sea publica');

  const bPublicWrite = await asUser(userB, `update landing_pages set name='mia' where id=$1 returning id`, [landing.id]);
  check(bPublicWrite.length === 0, 'Una landing publica no se puede modificar desde otra cuenta');

  /* ------------------------------------------------- 8. integridad */

  section('8. Integridad referencial');

  const dupVersion = await asUserExpectingError(
    userA,
    `insert into prompt_versions (prompt_id, owner_id, version, content) values ($1,$2,1,'x')`,
    [prompt.id, userA],
  );
  check(dupVersion === '23505', 'unique (prompt_id, version) impide versiones duplicadas', `codigo ${dupVersion}`);

  const badEnum = await asUserExpectingError(
    userA,
    `insert into generations (owner_id, provider_id, status) values ($1,'openai','success')`,
    [userA],
  );
  check(badEnum !== null, 'Los enums rechazan un proveedor desconocido', badEnum ? `rechazado (${badEnum})` : 'SE PERMITIO');

  // Borrado en cascada
  await asUser(userA, `delete from projects where id=$1`, [project.id]);
  const orphanPrompts = await asUser(userA, `select id from prompts where project_id=$1`, [project.id]);
  const orphanLandings = await asUser(userA, `select id from landing_pages where id=$1`, [landing.id]);
  check(orphanPrompts.length === 0, 'Borrar el proyecto arrastra sus prompts (on delete cascade)');
  check(
    orphanLandings.length === 1 && orphanLandings[0].id === landing.id,
    'La landing sobrevive al borrado del proyecto (on delete set null)',
  );
} catch (error) {
  bad('Excepcion inesperada', error.message);
  console.error(`${c.dim}${error.stack?.split('\n').slice(0, 3).join('\n')}${c.reset}`);
} finally {
  await client.query('rollback');
  console.log(`\n${c.dim}ROLLBACK ejecutado: no queda nada en la base.${c.reset}`);
  await client.end();
}

console.log(
  failures === 0
    ? `\n${c.green}${c.bold}EL ALMACEN SUPABASE ES CORRECTO${c.reset}`
    : `\n${c.red}${c.bold}${failures} COMPROBACIONES FALLIDAS${c.reset}`,
);
process.exit(failures === 0 ? 0 : 1);
