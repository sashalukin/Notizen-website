import { NextResponse } from 'next/server';

export function middleware(request) {
  const isProtected = request.nextUrl.pathname.startsWith('/notes');

  if (isProtected) {
    // Check for NextAuth session token cookie (works with JWT strategy)
    const token =
      request.cookies.get('authjs.session-token') ||
      request.cookies.get('__Secure-authjs.session-token');

    if (!token) {
      return NextResponse.redirect(new URL('/signin', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|uploads).*)'],
};
