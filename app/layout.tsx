import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import { ToastProvider } from '@/components/ui/toast';
import { DbBootstrap } from '@/components/providers/db-bootstrap';
import { SettingsProvider } from '@/components/providers/settings-context';
import { LocaleProvider } from '@/components/providers/locale-context';
import { AppSidebarBrand } from '@/components/app-sidebar-brand';
import { SidebarNav } from '@/components/sidebar-nav';

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
              {/* Full-width PWA status strip */}
              <ServiceWorkerRegister />

              {/* App shell: sidebar + main */}
              <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[260px_1fr]">

                {/* ── Sidebar ───────────────────────────────────────────── */}
                <aside className="bg-slate-900 text-white flex flex-col lg:min-h-screen lg:sticky lg:top-0">

                  {/* Brand — hidden on mobile (shown in horizontal bar below) */}
                  <div className="hidden lg:block px-5 pt-6 pb-4">
                    <AppSidebarBrand />
                  </div>

                  {/* Mobile brand bar */}
                  <div className="flex lg:hidden items-center gap-3 px-4 py-3 border-b border-white/10">
                    <span className="font-bold text-base tracking-tight">Shopkeeper POS</span>
                  </div>

                  {/* Navigation */}
                  <SidebarNav />
                </aside>

                {/* ── Main content ─────────────────────────────────────── */}
                <main className="p-4 lg:p-6 min-w-0">
                  <DbBootstrap>{children}</DbBootstrap>
                </main>
              </div>
            </ToastProvider>
          </SettingsProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
