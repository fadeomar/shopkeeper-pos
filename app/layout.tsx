import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import { ToastProvider } from '@/components/ui/toast';
import { SettingsProvider } from '@/components/providers/settings-context';
import { LocaleProvider } from '@/components/providers/locale-context';
import { AuthProvider } from '@/components/providers/auth-context';
import { SyncProvider } from '@/components/providers/sync-provider';
import { AuthenticatedShell } from '@/components/auth/authenticated-shell';

const plusJakartaSans = localFont({
  src: './fonts/PlusJakartaSans-latin.woff2',
  variable: '--font-plus-jakarta-sans',
  weight: '400 800',
  display: 'swap',
});

const ibmPlexSansArabic = localFont({
  src: [
    { path: './fonts/IBMPlexSansArabic-arabic-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-arabic-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-arabic-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-arabic-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-ibm-plex-sans-arabic',
  display: 'swap',
});

const jetBrainsMono = localFont({
  src: './fonts/JetBrainsMono-latin.woff2',
  variable: '--font-jetbrains-mono',
  weight: '400 700',
  display: 'swap',
});

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
    apple: '/icons/icon-192.png',
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
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var l=localStorage.getItem('shopkeeper-pos-locale');if(l==='ar'){var d=document.documentElement;d.lang='ar';d.dir='rtl';}}catch(e){}})()` }} />
      </head>
      <body
        className={`${plusJakartaSans.variable} ${ibmPlexSansArabic.variable} ${jetBrainsMono.variable} bg-app min-h-screen text-fg`}
        suppressHydrationWarning
      >
        <LocaleProvider>
          <SettingsProvider>
            <ToastProvider>
              <ServiceWorkerRegister />
              <AuthProvider>
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
