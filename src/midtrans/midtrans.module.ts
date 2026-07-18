import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MidtransController } from './midtrans.controller';
import { MidtransService } from './midtrans.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [MidtransController],
  providers: [MidtransService],
  exports: [MidtransService],
})
export class MidtransModule {}
