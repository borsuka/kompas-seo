import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { checkoutSchema } from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  Public,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import { BillingService } from './billing.service.js';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('billing:read')
  overview(@CurrentOrg() org: OrgContext) {
    return this.billing.overview(org.id);
  }

  /** Stripe Checkout for a paid plan (owner only). */
  @Post('checkout')
  @HttpCode(200)
  @RequirePermission('billing:manage')
  checkout(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Body({ schema: checkoutSchema }) body: z.output<typeof checkoutSchema>,
  ) {
    return this.billing.checkout(
      { organizationId: org.id, email: user.email, locale: user.locale ?? 'bg' },
      body.plan,
    );
  }

  /** Stripe customer portal: change plan, payment method, invoices, cancellation. */
  @Post('portal')
  @HttpCode(200)
  @RequirePermission('billing:manage')
  portal(@CurrentOrg() org: OrgContext) {
    return this.billing.portal(org.id);
  }

  /** Stripe webhooks (raw body, signature verified). */
  @Post('webhook')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(@Req() req: AppRequest) {
    const event = this.billing.constructEvent(
      req.body as Buffer,
      req.headers['stripe-signature'] as string | undefined,
    );
    await this.billing.handle(event);
    return { received: true };
  }
}
