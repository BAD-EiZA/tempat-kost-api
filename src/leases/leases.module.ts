import { Module } from '@nestjs/common';
import { DepositsModule } from '../deposits/deposits.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { LeasesController } from './leases.controller';
import { LeasesService } from './leases.service';

@Module({
  imports: [WorkspacesModule, DepositsModule],
  controllers: [LeasesController],
  providers: [LeasesService],
  exports: [LeasesService],
})
export class LeasesModule {}
