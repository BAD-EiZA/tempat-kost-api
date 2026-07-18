import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateMe(auth: AuthUser) {
    const user = await this.prisma.user.upsert({
      where: { externalUserId: auth.externalUserId },
      create: {
        externalUserId: auth.externalUserId,
        email: auth.email,
      },
      update: {
        email: auth.email ?? undefined,
      },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            workspace: true,
            role: true,
          },
        },
      },
    });

    return {
      id: user.id,
      externalUserId: user.externalUserId,
      email: user.email,
      fullName: user.fullName,
      locale: user.locale,
      timezone: user.timezone,
      workspaces: user.memberships.map((m) => ({
        membershipId: m.id,
        workspaceId: m.workspaceId,
        workspaceName: m.workspace.name,
        workspaceSlug: m.workspace.slug,
        roleKey: m.role.key,
        status: m.workspace.status,
      })),
      // nav hints by role
      menu: this.menuForRoles(
        user.memberships.map((m) => m.role.key),
      ),
    };
  }

  private menuForRoles(roleKeys: string[]) {
    const isOwner = roleKeys.includes('owner') || roleKeys.includes('admin');
    const isFinance = roleKeys.includes('finance') || isOwner;
    const isField =
      roleKeys.includes('field') ||
      roleKeys.includes('technician') ||
      isOwner;
    const isManager = roleKeys.includes('manager') || isOwner;

    const items: Array<{ href: string; label: string }> = [
      { href: '/dashboard', label: 'Overview' },
    ];
    if (isManager || isOwner) {
      items.push(
        { href: '/dashboard/properties', label: 'Properti' },
        { href: '/dashboard/rooms', label: 'Kamar' },
        { href: '/dashboard/tenants', label: 'Penyewa' },
        { href: '/dashboard/leases', label: 'Kontrak' },
        { href: '/dashboard/crm', label: 'CRM' },
        { href: '/dashboard/maintenance', label: 'Maint.' },
      );
    }
    if (isFinance) {
      items.push(
        { href: '/dashboard/billing', label: 'Tagihan' },
        { href: '/dashboard/payments', label: 'Bayar' },
        { href: '/dashboard/expenses', label: 'Biaya' },
        { href: '/dashboard/deposits', label: 'Deposit' },
        { href: '/dashboard/reports', label: 'Report' },
      );
    }
    if (isField) {
      items.push(
        { href: '/dashboard/meters', label: 'Meter' },
        { href: '/dashboard/ops', label: 'Ops' },
        { href: '/dashboard/inspections', label: 'Inspeksi' },
        { href: '/dashboard/inventory', label: 'Invent' },
      );
    }
    if (isOwner) {
      items.push(
        { href: '/dashboard/team', label: 'Tim' },
        { href: '/dashboard/roles', label: 'Roles' },
        { href: '/dashboard/ai', label: 'AI' },
        { href: '/dashboard/search', label: 'Search' },
        { href: '/dashboard/insights', label: 'Insights' },
        { href: '/dashboard/settings', label: 'Settings' },
        { href: '/dashboard/publish', label: 'Public' },
        { href: '/dashboard/import', label: 'Import' },
        { href: '/dashboard/approvals', label: 'Approve' },
        { href: '/dashboard/structure', label: 'Struktur' },
        { href: '/dashboard/flags', label: 'Flags' },
        { href: '/dashboard/audit-log', label: 'Audit' },
      );
    }
    items.push({ href: '/portal', label: 'Portal' });
    // dedupe by href
    const seen = new Set<string>();
    return items.filter((i) => {
      if (seen.has(i.href)) return false;
      seen.add(i.href);
      return true;
    });
  }
}
