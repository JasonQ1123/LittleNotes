import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from './auth';

export const spaceConflict = (code = 'SPACE_CHANGED', message = '空间状态已变化，请刷新后重试') =>
  new ConflictException({ code, message });

// Include the live relationship in the query, not just the guard's earlier snapshot.
export function activeSpaceScope(user: Actor): Prisma.SpaceWhereInput {
  return {
    id: user.spaceId || '',
    status: 'active',
    members: { some: { id: user.id } },
    ...(user.spaceVersion === undefined ? {} : { lifecycleVersion: user.spaceVersion }),
  };
}

export async function requireActiveSpace(tx: Prisma.TransactionClient, user: Actor) {
  const space = await tx.space.findFirst({ where: activeSpaceScope(user) });
  if (!space) throw spaceConflict();
  // Serialize every content mutation against closure, even when the closing transaction
  // does not read that content table (a serializable read alone cannot enforce this).
  const locked = await tx.space.updateMany({
    where: { ...activeSpaceScope(user), lifecycleVersion: space.lifecycleVersion },
    data: { lifecycleVersion: space.lifecycleVersion },
  });
  if (!locked.count) throw spaceConflict();
  return space;
}

export async function invalidateRestoreRequests(tx: Prisma.TransactionClient, userIds: string[]) {
  await tx.spaceRestoreRequest.updateMany({
    where: { status: 'pending', space: { memberships: { some: { userId: { in: userIds } } } } },
    data: { status: 'invalidated', resolvedAt: new Date() },
  });
}

export const spaceMissing = () => new NotFoundException('空间不存在，或你没有操作权限');
