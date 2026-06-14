import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import { ToastProvider } from '@/components/ui/toast';
import { SettingsProvider } from '@/components/providers/settings-context';
import { LocaleProvider } from '@/components/providers/locale-context';
import { AuthProvider } from '@/components/providers/auth-context';
import { SyncProvider } from '@/components/providers/sync-provider';
import { AuthenticatedShell } from '@/components/auth/authenticated-shell';

const APP_NAME = 'Asas POS';
const APP_DESCRIPTION =
  'Asas — the offline-first point-of-sale app built for small shops. Manage products, bills, inventory, customers, and reports. Works without internet.';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s — ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: ['POS', 'point of sale', 'inventory', 'offline POS', 'small business', 'أساس', 'نقطة بيع'],
  authors: [{ name: 'Asas' }],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_NAME,
  },
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    type: 'website',
    locale: 'ar_PS',
    alternateLocale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-192.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1F6F43' },
    { media: '(prefers-color-scheme: dark)', color: '#1F6F43' },
  ],
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning because LocaleProvider sets lang/dir on mount */
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
    >
      {/* Runs before React hydration so lang/dir is correct even if hydration stalls offline */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var k='shopkeeper-pos-locale';var l=localStorage.getItem(k);if(l!=='ar'&&l!=='en'){var m=document.cookie.match(new RegExp('(?:^|; )'+k+'=([^;]+)'));l=m?decodeURIComponent(m[1]):'';}if(l!=='ar'&&l!=='en'){l=(navigator.language||'').toLowerCase().indexOf('ar')===0?'ar':'en';}var d=document.documentElement;d.lang=l;d.dir=l==='ar'?'rtl':'ltr';}catch(e){}})()` }} />
      </head>
      <body className="bg-app min-h-dvh text-fg" suppressHydrationWarning>
        <LocaleProvider>
          <SettingsProvider>
            <ToastProvider>
              <AuthProvider>
                <ServiceWorkerRegister />
                <SyncProvider>
                  <AuthenticatedShell>
                    {children}
                  </AuthenticatedShell>
                </SyncProvider>
              </AuthProvider>
            </ToastProvider>
          </SettingsProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
