import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getDb } from "@/lib/db";

export const { handlers, auth } = NextAuth(() => ({
  adapter: PrismaAdapter(getDb()),
  providers: [Google],
  session: { strategy: "database" },
  callbacks: { session({ session, user }) { session.user.id = user.id; return session; } },
}));
