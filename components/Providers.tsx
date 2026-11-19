'use client';

import React from 'react';
import { MotionConfig } from 'motion/react';
import { FirebaseErrorBoundary } from '@/components/firebase/FirebaseErrorBoundary';
import {
  AuthProvider,
  type LibraryIdentity,
  type SessionUser,
} from '@/components/ui/AuthProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';

export function Providers({
  children,
  initialUser,
  initialLibrary,
  initialUnreadNotifications,
}: {
  children: React.ReactNode;
  initialUser?: SessionUser | null;
  initialLibrary?: LibraryIdentity;
  initialUnreadNotifications?: number;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <FirebaseErrorBoundary>
        <AuthProvider
          initialUser={initialUser}
          initialLibrary={initialLibrary}
          initialUnreadNotifications={initialUnreadNotifications}
        >
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </FirebaseErrorBoundary>
    </MotionConfig>
  );
}
