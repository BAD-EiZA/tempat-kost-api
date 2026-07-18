import { AiService } from './ai.service';

describe('AiService', () => {
  it('marks a provider failure terminal instead of leaving the job processing', async () => {
    const ai = {
      categorizeExpense: jest.fn().mockRejectedValue(new Error('timed out')),
    };
    const prisma = {
      aiJob: {
        create: jest.fn().mockResolvedValue({ id: 'job-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const workspaces = {
      assertPermission: jest
        .fn()
        .mockResolvedValue({ user: { id: 'user-1' } }),
    };
    const subscriptions = { consumeAiCredit: jest.fn().mockResolvedValue({}) };
    const service = new AiService(
      ai as never,
      prisma as never,
      workspaces as never,
      subscriptions as never,
    );

    await expect(
      service.categorizeExpense({} as never, {
        workspaceId: 'workspace-1',
        description: 'test',
      }),
    ).rejects.toThrow('timed out');
    expect(workspaces.assertPermission).toHaveBeenCalledWith(
      {},
      'workspace-1',
      'expense',
      'create',
    );
    expect(prisma.aiJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'FAILED', errorMessage: 'timed out' },
    });
  });
});
