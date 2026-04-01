import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "SUPER_ADMIN" | "VIEWER";
    };
  }

  interface User {
    role: "SUPER_ADMIN" | "VIEWER";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: "SUPER_ADMIN" | "VIEWER";
    id?: string;
  }
}
