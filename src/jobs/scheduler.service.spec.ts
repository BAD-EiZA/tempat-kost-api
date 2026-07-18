import { SchedulerService } from './scheduler.service';

describe('SchedulerService reminders', () => {
  it('delivers invoice reminders to linked tenant portal users only', async () => {
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'invoice-1',
            tenantId: 'tenant-1',
            invoiceNumber: 'INV-1',
            dueDate: new Date('2026-07-20T00:00:00.000Z'),
          },
          {
            id: 'invoice-2',
            tenantId: null,
            invoiceNumber: 'INV-2',
            dueDate: new Date('2026-07-20T00:00:00.000Z'),
          },
        ]),
      },
    };
    const notifications = {
      notifyTenantPortal: jest.fn().mockResolvedValue(true),
    };
    const service = new SchedulerService(
      prisma as never,
      notifications as never,
      {} as never,
    );

    await expect(service.runReminderScheduler()).resolves.toEqual({ sent: 1 });
    expect(notifications.notifyTenantPortal).toHaveBeenCalledWith(
      'tenant-1',
      'Pengingat tagihan',
      'INV-1 jatuh tempo 2026-07-20',
      'invoice',
      'invoice-1',
    );
    expect(notifications.notifyTenantPortal).toHaveBeenCalledTimes(1);
  });

  it('does not count an existing notification as sent', async () => {
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'invoice-1',
            tenantId: 'tenant-1',
            invoiceNumber: 'INV-1',
            dueDate: new Date('2026-07-20T00:00:00.000Z'),
          },
        ]),
      },
    };
    const notifications = {
      notifyTenantPortal: jest.fn().mockResolvedValue(false),
    };
    const service = new SchedulerService(
      prisma as never,
      notifications as never,
      {} as never,
    );

    await expect(service.runReminderScheduler()).resolves.toEqual({ sent: 0 });
  });
});
