import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
