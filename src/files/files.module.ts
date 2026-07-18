import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { FilesController } from './files.controller';

@Module({
  imports: [WorkspacesModule],
  controllers: [FilesController],
})
export class FilesModule {}
