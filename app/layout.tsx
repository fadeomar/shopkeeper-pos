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

// Fonts are VENDORED locally (app/fonts/*.woff2) and loaded via
// next/font/local so the production build never reaches out to Google at
// build time — a hard requirement for our offline-first / air-gapped builds.
// To refresh the files, run: node scripts/vendor-fonts.mjs
// `variable` exposes each as a CSS custom property so globals.css can stack
// the Arabic family in the same font-family chain without JS.
//
// Plus Jakarta Sans + JetBrains Mono are variable fonts (single file, weight
// range). IBM Plex Sans Arabic is static, so we list one file per weight.
const fontSans = localFont({
  src: './fonts/PlusJakartaSans-latin.woff2',
  display: 'swap',
  variable: '--font-sans',
  weight: '400 800',
});

const fontArabic = localFont({
  src: [
    { path: './fonts/IBMPlexSansArabic-arabic-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-arabic-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-arabic-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-arabic-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-arabic',
});

const fontMono = localFont({
  src: './fonts/JetBrainsMono-latin.woff2',
  display: 'swap',
  variable: '--font-mono',
  weight: '400 700',
});

export const metadata: Metadata = {
  title: 'Shopkeeper POS',
  description: 'Offline-first supermarket POS and inventory management system.',
  applicationName: 'Shopkeeper POS',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Shopkeeper POS' },
  icons: {
    icon: '/favicon.ico',
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = { themeColor: '#0b1220' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning because LocaleProvider sets lang/dir on mount */
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontArabic.variable} ${fontMono.variable}`}
    >
      {/* Runs before React hydration so lang/dir is correct even if hydration stalls offline */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var l=localStorage.getItem('shopkeeper-pos-locale');if(l==='ar'){var d=document.documentElement;d.lang='ar';d.dir='rtl';}}catch(e){}})()` }} />
      </head>
      <body className="bg-app min-h-screen text-fg" suppressHydrationWarning>
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
