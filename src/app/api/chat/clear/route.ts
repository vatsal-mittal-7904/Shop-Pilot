import { NextResponse } from 'next/server';
import { prisma } from '@/backend/db/prisma';

export async function POST() {
  await prisma.conversation.deleteMany({});
  await prisma.buyerIntent.deleteMany({});
  return NextResponse.json({ success: true });
}
