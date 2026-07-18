import { ReportsService } from './reports.service';

describe('ReportsService export', () => {
  it('enforces export permission and property scope, then safely escapes CSV', async () => {
    const invoice = {
      findMany: jest.fn().mockResolvedValue([
        {
          invoiceNumber: '=CMD("x")',
          status: 'OPEN',
          tenant: { fullName: 'Doe, "Jane"\nJr.' },
          total: 100,
          amountPaid: 0,
          dueDate: new Date('2026-07-18T00:00:00Z'),
        },
      ]),
    };
    const prisma = { invoice };
    const membership = { role: { key: 'manager' }, propertyAccess: [] };
    const workspaces = {
      assertPermission: jest.fn().mockResolvedValue({ membership }),
      propertyIdFilter: jest.fn().mockReturnValue({
        propertyId: { in: ['property-1'] },
      }),
      propertyScope: jest.fn().mockReturnValue(['property-1']),
    };
    const queue = { enqueue: jest.fn() };
    const service = new ReportsService(
      prisma as never,
      workspaces as never,
      queue,
    );

    const result = await service.exportCsv(
      { externalUserId: 'user-1' },
      'workspace-1',
      'invoices',
    );

    expect(workspaces.assertPermission).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
      'report',
      'export',
    );
    expect(invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'workspace-1',
          propertyId: { in: ['property-1'] },
        },
      }),
    );
    expect(result.csv).toContain('"\'=CMD(""x"")"');
    expect(result.csv).toContain('"Doe, ""Jane""\nJr."');
    expect(result.csv).toContain('\r\n');
  });
});
