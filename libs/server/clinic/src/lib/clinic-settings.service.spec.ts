import { ClinicSettingsService } from './clinic-settings.service';
import { describeWithDatabase } from './clinic.fixture';

describeWithDatabase('clinic tracking settings', (fx) => {
  const settings = () => new ClinicSettingsService(fx.db.database);
  const input = (overrides: Record<string, unknown> = {}) => ({
    estimatorEnabled: true,
    receptionVisible: true,
    parentVisible: false,
    guestEnabled: false,
    attendanceEnabled: false,
    fairnessEnabled: false,
    arrivalBufferMinutes: 15,
    earlyCheckInMinutes: 30,
    minimumTravelLeadMinutes: 30,
    publicationThresholdMinutes: 10,
    maxEarlierShiftMinutes: 15,
    configuredBaselineMinutes: 15,
    validateBaseline: false,
    approveParentEstimate: false,
    ...overrides,
  });

  it('allows a deliberate baseline to run in shadow mode before validation', async () => {
    await settings().tracking(
      fx.clinicId,
      fx.doctorMemberId,
      input(),
    );

    const result = await settings().read(fx.clinicId);
    expect(result.tracking).toMatchObject({
      estimatorEnabled: true,
      receptionVisible: true,
      parentVisible: false,
      configuredBaselineMinutes: 15,
      baselineValidatedAt: null,
    });
  });

  it('refuses parent visibility before the shadow release gate is approved', async () => {
    await expect(settings().tracking(
      fx.clinicId,
      fx.doctorMemberId,
      input({ parentVisible: true }),
    )).rejects.toMatchObject({ status: 400 });
  });
});
