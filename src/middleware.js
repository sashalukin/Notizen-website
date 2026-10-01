import { NextResponse } from 'next/server';

export function middleware(request) {
  // /notes is a user-free shell. APIs enforce authorization; cached device data is account-scoped.
  // Let an expired session reopen local drafts instead of redirecting away from them.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|uploads).*)'],
};
