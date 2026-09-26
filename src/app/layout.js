import './globals.css';
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';
import { SessionProvider } from 'next-auth/react';

export const metadata = {
  title: 'Notizen',
  description: 'A simple note-taking app',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/android-chrome-192x192.png',
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <ServiceWorkerRegistration />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
