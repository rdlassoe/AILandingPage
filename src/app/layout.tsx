import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'AI Landing Studio',
    template: '%s | AI Landing Studio',
  },
  description:
    'Plataforma de ingenieria de prompts para disenar, generar, auditar y versionar Landing Pages con modelos de lenguaje.',
  applicationName: 'AI Landing Studio',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf8' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1012' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
