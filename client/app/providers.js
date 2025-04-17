'use client';
import { useState, useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { ConfigProvider, theme } from 'antd';

export default function Providers({ children }) {
  return (
    <SessionProvider>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#ff4500', // Reddit's orange color
            borderRadius: 4,
          },
        }}
      >
        {children}
      </ConfigProvider>
    </SessionProvider>
  );
}
