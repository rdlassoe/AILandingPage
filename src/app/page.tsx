import { redirect } from 'next/navigation';

import { getOptionalUser } from '@/lib/auth/session';

export default async function RootPage() {
  const user = await getOptionalUser();
  redirect(user ? '/dashboard' : '/login');
}
