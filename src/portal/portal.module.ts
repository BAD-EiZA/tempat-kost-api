import { Module } from '@nestjs/common';
import { MidtransModule } from '../midtrans/midtrans.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [MidtransModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
