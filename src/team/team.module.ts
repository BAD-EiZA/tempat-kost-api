import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { RolesService } from './roles.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [TeamController],
  providers: [TeamService, RolesService],
})
export class TeamModule {}
