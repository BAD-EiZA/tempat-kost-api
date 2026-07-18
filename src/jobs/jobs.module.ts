import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [CrmModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class JobsModule {}
