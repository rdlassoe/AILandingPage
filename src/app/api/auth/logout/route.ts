import { NextResponse } from 'next/server';

import { endLocalSession } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Cierre de sesion. Se expone como POST para que no sea disparable por un enlace. */
export async function POST(request: Request) {
  if (env.supabase.enabled) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } else {
    await endLocalSession();
  }
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
