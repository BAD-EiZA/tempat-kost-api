import { UnauthorizedException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService authorization', () => {
  const auth = { externalUserId: 'external-user' };
  const user = { id: 'user-1' };
  const audit = { log: jest.fn() };

  function service(membership: object) {
    const prisma = {
      user: { upsert: jest.fn().mockResolvedValue(user) },
      workspaceMember: { findUnique: jest.fn().mockResolvedValue(membership) },
    };
    return new WorkspacesService(prisma as never, audit as never);
  }

  it('denies an active member without the requested permission', async () => {
    const workspaces = service({
      status: 'ACTIVE',
      role: { key: 'manager', permissions: [] },
      propertyAccess: [],
    });

    await expect(
      workspaces.assertPermission(auth, 'workspace-1', 'invoice', 'create'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts an explicit role permission', async () => {
    const workspaces = service({
      status: 'ACTIVE',
      role: {
        key: 'finance',
        permissions: [{ resource: 'invoice', action: 'create' }],
      },
      propertyAccess: [],
    });

    await expect(
      workspaces.assertPermission(auth, 'workspace-1', 'invoice', 'create'),
    ).resolves.toMatchObject({ user });
  });

  it('rejects a property outside an active limited scope', () => {
    const workspaces = service({});
    expect(() =>
      workspaces.assertPropertyInScope(
        {
          role: { key: 'manager' },
          propertyAccess: [{ propertyId: 'property-1', expiresAt: null }],
        },
        'property-2',
      ),
    ).toThrow(UnauthorizedException);
  });
});
