import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MetersController } from './meters.controller';
import { MetersService } from './meters.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [MetersController],
  providers: [MetersService],
})
export class MetersModule {}
