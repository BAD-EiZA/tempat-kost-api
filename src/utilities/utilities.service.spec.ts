import { UtilitiesService } from './utilities.service';

describe('UtilitiesService.calculateCharge', () => {
  const service = new UtilitiesService(
    {} as never,
    {} as never,
    {} as never,
  );

  it('SHARED: owner 20 kWh, tenant pays rest @ 1700', () => {
    const r = service.calculateCharge({
      payerType: 'SHARED',
      billingMethod: 'INDIVIDUAL_POSTPAID_METER',
      consumption: 80,
      ratePerUnit: 1700,
      ownerUnitAllowance: 20,
    });
    expect(r.tenantCharge.toNumber()).toBe(102000);
    expect(r.ownerCost.toNumber()).toBe(34000);
  });

  it('OWNER: no tenant charge', () => {
    const r = service.calculateCharge({
      payerType: 'OWNER',
      billingMethod: 'INDIVIDUAL_POSTPAID_METER',
      consumption: 50,
      ratePerUnit: 1700,
    });
    expect(r.tenantCharge.toNumber()).toBe(0);
    expect(r.ownerCost.toNumber()).toBe(85000);
  });

  it('FIXED_MONTHLY tenant', () => {
    const r = service.calculateCharge({
      payerType: 'TENANT',
      billingMethod: 'FIXED_MONTHLY',
      consumption: 0,
      fixedMonthlyFee: 150000,
    });
    expect(r.tenantCharge.toNumber()).toBe(150000);
  });
});
