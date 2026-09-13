import { describe, expect, it } from 'vitest';
import { ClinicMemberRole } from '@clinic/contracts';
import {
  canCallNext,
  canManageQueue,
  canRecordMeasurements,
} from './queue-permissions';

describe('queue permissions', () => {
  it('gives reception the desk commands', () => {
    expect(canManageQueue(ClinicMemberRole.Reception)).toBe(true);
    expect(canManageQueue(ClinicMemberRole.Admin)).toBe(true);
    expect(canManageQueue(ClinicMemberRole.Doctor)).toBe(false);
    expect(canManageQueue(null)).toBe(false);
  });

  it('keeps measurement capture away from reception', () => {
    expect(canRecordMeasurements(ClinicMemberRole.Reception)).toBe(false);
    expect(canRecordMeasurements(ClinicMemberRole.Doctor)).toBe(true);
    expect(canRecordMeasurements(ClinicMemberRole.Admin)).toBe(true);
    expect(canRecordMeasurements(null)).toBe(false);
  });

  it('leaves summoning the next patient to the desk', () => {
    expect(canCallNext(ClinicMemberRole.Reception)).toBe(true);
    expect(canCallNext(ClinicMemberRole.Admin)).toBe(true);
    expect(canCallNext(ClinicMemberRole.Doctor)).toBe(false);
    expect(canCallNext(null)).toBe(false);
  });

  it('splits the doctor and the desk on every queue decision', () => {
    // The doctor reads vitals and ends her own consultation; she never moves
    // the line. Reception moves the line and never writes a clinical reading.
    expect(canManageQueue(ClinicMemberRole.Doctor)).toBe(false);
    expect(canCallNext(ClinicMemberRole.Doctor)).toBe(false);
    expect(canRecordMeasurements(ClinicMemberRole.Doctor)).toBe(true);

    expect(canManageQueue(ClinicMemberRole.Reception)).toBe(true);
    expect(canCallNext(ClinicMemberRole.Reception)).toBe(true);
    expect(canRecordMeasurements(ClinicMemberRole.Reception)).toBe(false);
  });
});
