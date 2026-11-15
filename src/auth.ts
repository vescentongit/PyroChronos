import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getDb } from "@/lib/db";
import {safeOperationalEvent} from '@/lib/research-deployment';

export const { handlers, auth } = NextAuth(() => ({
  adapter: PrismaAdapter(getDb()),
  providers: [Google],
  session: { strategy: "database" },
  debug: false,
  logger: { error() { console.error(JSON.stringify(safeOperationalEvent('auth_error'))); }, warn() { console.warn(JSON.stringify(safeOperationalEvent('auth_warning'))); }, debug() {} },
  callbacks: { session({ session, user }) { session.user.id = user.id; return session; } },
}));
