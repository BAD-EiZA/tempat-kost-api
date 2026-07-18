import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
