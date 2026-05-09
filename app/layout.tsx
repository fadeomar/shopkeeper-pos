import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import { ToastProvider } from '@/components/ui/toast';
import { SettingsProvider } from '@/components/providers/settings-context';
import { LocaleProvider } from '@/components/providers/locale-context';
import { AuthProvider } from '@/components/providers/auth-context';
import { SyncProvider } from '@/components/providers/sync-provider';
import { AuthenticatedShell } from '@/components/auth/authenticated-shell';

export const metadata: Metadata = {
  title: 'Shopkeeper POS',
  description: 'Offline-first supermarket POS and inventory management system.',
  applicationName: 'Shopkeeper POS',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Shopkeeper POS' },
};

export const viewport: Viewport = { themeColor: '#0f172a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning because LocaleProvider sets lang/dir on mount */
    <html lang="en" dir="ltr" suppressHydrationWarning>
      {/* Runs before React hydration so lang/dir is correct even if hydration stalls offline */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var l=localStorage.getItem('shopkeeper-pos-locale');if(l==='ar'){var d=document.documentElement;d.lang='ar';d.dir='rtl';}}catch(e){}})()` }} />
      </head>
      <body className="bg-slate-50 min-h-screen" suppressHydrationWarning>
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
