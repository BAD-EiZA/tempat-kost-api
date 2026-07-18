import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { validateEnv } from './common/config/env.validation';
import { InfraModule } from './common/infra/infra.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { ContractsModule } from './contracts/contracts.module';
import { CrmModule } from './crm/crm.module';
import { DepositsModule } from './deposits/deposits.module';
import { ExpensesModule } from './expenses/expenses.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { InsightsModule } from './insights/insights.module';
import { InternalModule } from './internal/internal.module';
import { InventoryModule } from './inventory/inventory.module';
import { InvoicesModule } from './invoices/invoices.module';
import { JobsModule } from './jobs/jobs.module';
import { LeasesModule } from './leases/leases.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { MetersModule } from './meters/meters.module';
import { MidtransModule } from './midtrans/midtrans.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { OpsModule } from './ops/ops.module';
import { PaymentsModule } from './payments/payments.module';
import { PortalModule } from './portal/portal.module';
import { PropertiesModule } from './properties/properties.module';
import { PublicModule } from './public/public.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { ReportsModule } from './reports/reports.module';
import { RoomsModule } from './rooms/rooms.module';
import { SearchModule } from './search/search.module';
import { StructureModule } from './structure/structure.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TeamModule } from './team/team.module';
import { TenantsModule } from './tenants/tenants.module';
import { UtilitiesModule } from './utilities/utilities.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AuditModule,
    AuditLogsModule,
    InfraModule,
    NotificationsModule,
    SubscriptionsModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    TeamModule,
    PropertiesModule,
    StructureModule,
    RoomsModule,
    TenantsModule,
    DepositsModule,
    LeasesModule,
    ContractsModule,
    InvoicesModule,
    PaymentsModule,
    ReceiptsModule,
    MidtransModule,
    ExpensesModule,
    UtilitiesModule,
    MetersModule,
    MaintenanceModule,
    InventoryModule,
    CrmModule,
    PublicModule,
    ImportsModule,
    SearchModule,
    InsightsModule,
    ReportsModule,
    OpsModule,
    OnboardingModule,
    PortalModule,
    AiModule,
    AdminModule,
    JobsModule,
    FilesModule,
    InternalModule,
  ],
})
export class AppModule {}

