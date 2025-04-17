'use client';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';

export default function ProtectedRoute({ children, adminOnly = false, requiredRole = null }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    if (!session) {
      router.push('/login');
      return;
    }

    if (adminOnly && !session.user.isAdmin) {
      router.push('/');
      return;
    }

    if (requiredRole && session.user.role !== requiredRole && !session.user.isAdmin) {
      router.push('/');
      return;
    }
  }, [session, status, router, adminOnly, requiredRole]);

  if (status === 'loading') {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Spin size="large" tip="Loading..." />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  if (
    (adminOnly && !session.user.isAdmin) ||
    (requiredRole && session.user.role !== requiredRole && !session.user.isAdmin)
  ) {
    return null;
  }

  return children;
}
