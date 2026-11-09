import {PrismaClient} from '@prisma/client';
const globalDb=globalThis as unknown as {prisma?:PrismaClient};
export function getDb(){if(!process.env.DATABASE_URL)throw new Error('Database belum dikonfigurasi');return globalDb.prisma??(globalDb.prisma=new PrismaClient());}
