import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
