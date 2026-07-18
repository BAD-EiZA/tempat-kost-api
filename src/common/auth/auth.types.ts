export type AuthUser = {
  externalUserId: string;
  userId?: string;
  email?: string;
  sessionId?: string;
};

export type WorkspaceContext = {
  workspaceId: string;
  memberId: string;
  roleKey: string;
  propertyIds: string[] | 'all';
};
