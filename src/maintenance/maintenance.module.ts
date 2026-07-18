import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [WorkspacesModule, AiModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
