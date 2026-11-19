'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { FIREBASE_DATABASE_ID, FIREBASE_PROJECT_ID } from '@/lib/firebase/client';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  isQuotaError: boolean;
}

export class FirebaseErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', isQuotaError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const raw = error?.message || 'Terjadi kesalahan saat berkomunikasi dengan database.';
    let readable = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error) {
        readable = `${parsed.error}${parsed.path ? ` (${parsed.operationType} ${parsed.path})` : ''}`;
      }
    } catch {
      // plain error string
    }
    const isQuotaError =
      readable.includes('Quota exceeded') ||
      readable.includes('Free daily read units per project');
    return { hasError: true, message: readable, isQuotaError };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const upgradeUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIREBASE_DATABASE_ID}/data?openUpgradeDialog=true`;

    return (
      <div className="min-h-screen bg-[#F4F3EE] px-6 py-12 flex items-center justify-center text-[#1E2433]">
        <div className="max-w-lg w-full rounded-2xl border border-[#E7E4DC] bg-[#FAF9F5] p-8 space-y-4">
          <div className="flex items-center gap-3 text-[#C94A43]">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            <h1 className="font-serif text-xl font-semibold text-[#1E2433]">
              {this.state.isQuotaError
                ? 'Batas Kuota Harian Firebase Free Plan Tercapai'
                : 'Terjadi Kendala Koneksi Layanan'}
            </h1>
          </div>

          <p className="text-sm leading-relaxed text-[#5C5E64]">
            {this.state.isQuotaError
              ? 'Penggunaan baca/tulis harian Firestore Spark Plan telah mencapai kuota gratis hari ini dan akan direset otomatis besok.'
              : this.state.message}
          </p>

          {this.state.isQuotaError && (
            <a
              href={upgradeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs font-medium text-[#E56B63] underline"
            >
              Lihat detail kuota database di Firebase Console
            </a>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '', isQuotaError: false });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 rounded-full bg-[#222B3A] px-5 py-2 text-xs font-medium text-white hover:bg-[#161D28] cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      </div>
    );
  }
}
