import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;

    // VIEWER role: only GET requests allowed
    if (token?.role === "VIEWER" && req.method !== "GET") {
      return NextResponse.json(
        { error: "Permisos insuficientes" },
        { status: 403 }
      );
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/((?!login|api/auth|api/setup|api/cron|_next/static|_next/image|favicon.ico|isotipo.svg|logo.svg).*)",
  ],
};
