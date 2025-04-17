'use client';
import '@ant-design/v5-patch-for-react-19';

import './globals.css';
import { Inter } from 'next/font/google';
import Providers from './providers';
import axios from 'axios';
axios.defaults.withCredentials = true;
const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
