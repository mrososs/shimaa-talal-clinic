import { cleanupDashboardJourney, removeFixtureFile } from './fixture.js';

export default async function globalTeardown(): Promise<void> {
  try {
    await cleanupDashboardJourney();
  } finally {
    removeFixtureFile();
  }
}
