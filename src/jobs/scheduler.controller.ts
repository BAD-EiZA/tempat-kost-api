import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalSecretGuard } from '../common/auth/internal-secret.guard';
import { Public } from '../common/auth/public.decorator';
import { SchedulerService } from './scheduler.service';

@Controller('v1/internal/cron')
@Public()
@UseGuards(InternalSecretGuard)
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Get('invoice-scheduler')
  invoices() {
    return this.scheduler.runInvoiceScheduler();
  }

  @Get('reminder-scheduler')
  reminders() {
    return this.scheduler.runReminderScheduler();
  }

  @Get('lease-expiry')
  leaseExpiry() {
    return this.scheduler.runLeaseExpiry();
  }

  @Get('subscription-check')
  subscriptions() {
    return this.scheduler.runSubscriptionCheck();
  }

  @Get('booking-expiry')
  bookings() {
    return this.scheduler.runBookingExpiry();
  }

  @Get('recurring-expenses')
  recurring() {
    return this.scheduler.runRecurringExpenses();
  }

  @Get('outbox-drain')
  outbox() {
    return this.scheduler.runOutboxDrain();
  }
}
