import { NextResponse } from 'next/server';
import firebaseConfigJson from '@/firebase-applet-config.json';
import { resolveDataBackendMode } from '@/lib/firebase/read-cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  const backendMode = resolveDataBackendMode(process.env.NEXT_PUBLIC_DATA_BACKEND);
  const firebaseProjectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId || '';
  const firestoreDatabaseId =
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
    firebaseConfigJson.firestoreDatabaseId ||
    '(default)';

  return NextResponse.json(
    {
      ok: true,
      app: 'Lentera Pustaka',
      backendMode,
      firebaseConfigured: Boolean(firebaseProjectId),
      firebaseProjectId,
      firestoreDatabaseId,
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
