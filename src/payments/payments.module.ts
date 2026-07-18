import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [WorkspacesModule, ReceiptsModule, AiModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
