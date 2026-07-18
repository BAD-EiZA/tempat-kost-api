import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService', () => {
  it('authorizes and scopes every query to the requested workspace', async () => {
    const findMany = jest.fn().mockReturnValue('items-query');
    const count = jest.fn().mockReturnValue('count-query');
    const prisma = {
      auditLog: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };
    const workspaces = { assertPermission: jest.fn().mockResolvedValue({}) };
    const service = new AuditLogsService(prisma as never, workspaces as never);

    await service.list(
      { externalUserId: 'user-1' },
      {
        workspaceId: 'workspace-1',
        action: 'invoice.issued',
        page: 2,
        pageSize: 10,
      },
    );

    expect(workspaces.assertPermission).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
      'audit',
      'view',
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-1' }),
        skip: 10,
        take: 10,
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ workspaceId: 'workspace-1' }),
    });
  });
});
