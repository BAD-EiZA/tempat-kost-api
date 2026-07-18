import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { EMAIL_PORT, type EmailPort } from '../common/email/email.port';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const ROLE_PRESETS: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Property Manager',
  finance: 'Finance Staff',
  field: 'Field Staff',
  technician: 'Technician',
};

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
  ) {}

  async listMembers(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, externalUserId: true },
        },
        role: true,
        propertyAccess: true,
      },
    });
  }

  async listInvitations(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.invitation.findMany({
      where: { workspaceId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async ensureRole(workspaceId: string, key: string) {
    const name = ROLE_PRESETS[key] ?? key;
    let role = await this.prisma.role.findFirst({
      where: { workspaceId, key },
    });
    if (!role) {
      role = await this.prisma.role.create({
        data: {
          workspaceId,
          key,
          name,
          isSystem: true,
          permissions: {
            create: [
              { resource: 'property', action: 'view' },
              { resource: 'room', action: 'view' },
              { resource: 'tenant', action: 'view' },
              { resource: 'lease', action: 'view' },
              { resource: 'invoice', action: 'view' },
            ],
          },
        },
      });
    }
    return role;
  }

  async invite(
    auth: AuthUser,
    input: {
      workspaceId: string;
      email: string;
      roleKey: string;
      propertyIds?: string[];
    },
  ) {
    const { user } = await this.workspaces.assertMember(
      auth,
      input.workspaceId,
    );
    const role = await this.ensureRole(
      input.workspaceId,
      input.roleKey || 'manager',
    );
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId: input.workspaceId,
        email: input.email.toLowerCase(),
        roleId: role.id,
        token,
        invitedById: user.id,
        expiresAt,
        status: 'PENDING',
      },
    });

    // if user already exists, add membership immediately
    const existingUser = await this.prisma.user.findFirst({
      where: { email: input.email.toLowerCase() },
    });
    if (existingUser) {
      await this.acceptInternal(
        invitation.id,
        existingUser.id,
        input.propertyIds,
      );
    }

    const webUrl = this.config.get<string>('WEB_URL', 'http://localhost:3000');
    const inviteLink = `${webUrl}/invite/${token}`;
    await this.email.send({
      to: input.email.toLowerCase(),
      subject: 'Undangan bergabung — Tempat Kost',
      text: `Anda diundang sebagai ${role.name}. Buka: ${inviteLink}\nBerlaku sampai ${expiresAt.toISOString().slice(0, 10)}.`,
      html: `<p>Anda diundang sebagai <b>${role.name}</b>.</p><p><a href="${inviteLink}">Terima undangan</a></p>`,
    });

    await this.audit.log({
      workspaceId: input.workspaceId,
      actorUserId: user.id,
      action: 'team.invited',
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: { email: input.email, roleKey: role.key, inviteLink },
    });

    return { ...invitation, inviteLink };
  }

  private async acceptInternal(
    invitationId: string,
    userId: string,
    propertyIds?: string[],
  ) {
    const inv = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    if (!inv || inv.status !== 'PENDING') return;
    if (inv.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitationId },
        data: { status: 'EXPIRED' },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: inv.workspaceId,
            userId,
          },
        },
        create: {
          workspaceId: inv.workspaceId,
          userId,
          roleId: inv.roleId,
          status: 'ACTIVE',
        },
        update: {
          roleId: inv.roleId,
          status: 'ACTIVE',
        },
      });
      if (propertyIds?.length) {
        for (const propertyId of propertyIds) {
          await tx.memberPropertyAccess.upsert({
            where: {
              memberId_propertyId: { memberId: member.id, propertyId },
            },
            create: { memberId: member.id, propertyId },
            update: {},
          });
        }
      }
      await tx.invitation.update({
        where: { id: invitationId },
        data: { status: 'ACCEPTED' },
      });
    });
  }

  async acceptByToken(auth: AuthUser, token: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('Invitation not found');
    if (inv.status !== 'PENDING') {
      throw new BadRequestException('Invitation not pending');
    }
    const user = await this.prisma.user.upsert({
      where: { externalUserId: auth.externalUserId },
      create: {
        externalUserId: auth.externalUserId,
        email: auth.email?.toLowerCase(),
      },
      update: { email: auth.email?.toLowerCase() },
    });
    await this.acceptInternal(inv.id, user.id);
    return { workspaceId: inv.workspaceId };
  }

  async setPropertyAccess(
    auth: AuthUser,
    input: { memberId: string; propertyIds: string[] },
  ) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: input.memberId },
    });
    if (!member) throw new NotFoundException('Member not found');
    const { user } = await this.workspaces.assertMember(
      auth,
      member.workspaceId,
    );
    await this.prisma.memberPropertyAccess.deleteMany({
      where: { memberId: member.id },
    });
    if (input.propertyIds.length) {
      await this.prisma.memberPropertyAccess.createMany({
        data: input.propertyIds.map((propertyId) => ({
          memberId: member.id,
          propertyId,
        })),
      });
    }
    await this.audit.log({
      workspaceId: member.workspaceId,
      actorUserId: user.id,
      action: 'team.property_access_updated',
      entityType: 'workspace_member',
      entityId: member.id,
    });
    return this.listMembers(auth, member.workspaceId);
  }
}
