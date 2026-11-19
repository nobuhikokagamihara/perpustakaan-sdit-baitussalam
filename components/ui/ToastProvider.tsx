'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { EASE_EDITORIAL, MOTION_DURATION } from '@/lib/motion/presets';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  showToast: (variant: ToastVariant, title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (variant: ToastVariant, title: string, description?: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, variant, title, description }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="no-print fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 pointer-events-none"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              role="status"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-[#E2DFD7] bg-[#FAF9F5] p-3.5 shadow-lg"
            >
              {t.variant === 'success' && (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              )}
              {t.variant === 'error' && (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C94A43]" />
              )}
              {t.variant === 'info' && (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#E56B63]" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#1E2433]">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs text-[#5C5E64]">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Tutup notifikasi"
                className="rounded-full p-1 text-[#7B7D82] hover:bg-[#EFECE3] hover:text-[#1E2433] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
