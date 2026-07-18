import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
