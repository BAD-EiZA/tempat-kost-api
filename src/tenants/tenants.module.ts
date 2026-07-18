import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TenantDocumentsService } from './tenant-documents.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantDocumentsService],
  exports: [TenantsService],
})
export class TenantsModule {}
