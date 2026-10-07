import { Module } from '@nestjs/common';
import {
  ActiveOrganizationController,
  InvitationsController,
  MeController,
  OrganizationsController,
} from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  controllers: [
    MeController,
    OrganizationsController,
    ActiveOrganizationController,
    InvitationsController,
  ],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
