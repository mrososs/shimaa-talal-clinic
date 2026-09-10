import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFixture, type JourneyUser } from './fixture.js';

const dashboardUrl =
  process.env['E2E_DASHBOARD_URL'] ?? 'http://localhost:4203';
const mobileUrl = process.env['E2E_MOBILE_URL'] ?? 'http://localhost:4202';

async function signIn(
  page: Page,
  url: string,
  user: JourneyUser,
): Promise<void> {
  await page.goto(url);
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(user.email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    result.violations,
    result.violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join('\n'),
  ).toEqual([]);
}

test('parent request reaches completion, payment and role-safe reports', async ({
  browser,
}) => {
  const fixture = readFixture();
  const parentContext = await browser.newContext({
    viewport: { width: 412, height: 892 },
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
  });
  const receptionContext = await browser.newContext();
  const doctorContext = await browser.newContext();

  try {
    const parent = await parentContext.newPage();
    await signIn(parent, `${mobileUrl}/auth/sign-in`, fixture.parent);

    await expect(parent).toHaveURL(/\/tabs\/home$/);
    const mobileTabs = parent.getByRole('tablist', {
      name: 'التنقل الرئيسي',
    });
    await expect(mobileTabs).toBeVisible();
    await expect(parent.getByRole('tab')).toHaveCount(4);

    const mobileLayout = await parent.evaluate(() => {
      const tabBar = document.querySelector('ion-tab-bar');
      const tabButtons = [...document.querySelectorAll('ion-tab-button')];
      const tabBarRect = tabBar?.getBoundingClientRect();

      return {
        viewport: { width: innerWidth, height: innerHeight },
        direction: document.documentElement.dir,
        horizontalOverflow:
          document.documentElement.scrollWidth > innerWidth ||
          document.body.scrollWidth > innerWidth,
        tabBarBottom: tabBarRect?.bottom,
        tabButtonHeights: tabButtons.map(
          (button) => button.getBoundingClientRect().height,
        ),
      };
    });

    expect(mobileLayout.viewport).toEqual({ width: 412, height: 892 });
    expect(mobileLayout.direction).toBe('rtl');
    expect(mobileLayout.horizontalOverflow).toBe(false);
    expect(mobileLayout.tabBarBottom).toBeLessThanOrEqual(892);
    expect(mobileLayout.tabButtonHeights.every((height) => height >= 44)).toBe(
      true,
    );

    await parent.getByRole('tab', { name: 'المواعيد' }).click();
    await expect(parent).toHaveURL(/\/tabs\/appointments$/);
    await parent.getByRole('tab', { name: 'الرئيسية' }).click();
    await expect(parent).toHaveURL(/\/tabs\/home$/);

    await parent.goto(`${mobileUrl}/booking`);
    await expect(mobileTabs).toBeHidden();
    await expect(
      parent.getByRole('heading', { name: 'نوع الحجز' }),
    ).toBeVisible();
    await expect(
      parent.getByRole('heading', { name: 'من سيزور الطبيبة؟' }),
    ).toBeVisible();
    await expect(
      parent.getByRole('heading', { name: 'اختر اليوم' }),
    ).toBeVisible();
    await parent.locator(`[data-session-id="${fixture.sessionId}"]`).click();
    await parent.getByRole('button', { name: /المتابعة للدفع/ }).click();
    await expect(parent).toHaveURL(/\/payments\?appointmentId=[0-9a-f-]+$/);
    const appointmentId = new URL(parent.url()).searchParams.get(
      'appointmentId',
    );
    if (!appointmentId) {
      throw new Error('Booking did not return an appointment id.');
    }

    await expect(
      parent.getByRole('heading', { name: 'طريقة الدفع' }),
    ).toBeVisible();
    await expect(parent.locator('.invoice')).toContainText(fixture.childName);
    await expect(parent.locator('.method')).toHaveCount(2);
    expect(
      await parent.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await parent.goto(`${mobileUrl}/appointments/${appointmentId}`);
    await expect(parent.getByText('قيد المراجعة')).toBeVisible();

    await parent.goto(`${mobileUrl}/tabs/queue`);
    await expect(
      parent.getByText(`حجز ${fixture.childName} قيد المراجعة`),
    ).toBeVisible();
    await expect(
      parent.getByText('الحالة: بانتظار موافقة العيادة'),
    ).toBeVisible();

    const reception = await receptionContext.newPage();
    await signIn(reception, `${dashboardUrl}/sign-in`, fixture.reception);
    await reception.goto(`${dashboardUrl}/appointments`);
    const appointmentRow = reception.locator(
      `[data-appointment-id="${appointmentId}"]`,
    );
    await expect(appointmentRow).toContainText(fixture.childName);
    await appointmentRow.getByRole('button', { name: 'موافقة' }).click();
    await expect(appointmentRow).toContainText('مؤكّد');

    await reception.goto(`${dashboardUrl}/queue`);
    const expectedRow = reception.locator(
      `[data-appointment-id="${appointmentId}"]`,
    );
    await expect(expectedRow).toContainText(fixture.childName);
    await expectedRow.getByRole('button', { name: 'تسجيل الوصول' }).click();

    const waitingRow = reception
      .locator(`[data-entry-id][data-appointment-id="${appointmentId}"]`)
      .filter({ hasText: fixture.childName });
    await expect(waitingRow).toBeVisible();

    await parent.goto(`${mobileUrl}/tabs/queue`);
    await expect(parent.locator('.counter__ring')).toBeVisible();
    await expect(parent.getByText('دورك هو التالي')).toBeVisible();

    await reception.getByRole('button', { name: 'استدعاء التالي' }).click();
    const calledCard = reception.locator(
      `.now__patient[data-appointment-id="${appointmentId}"]`,
    );
    await expect(calledCard).toContainText('تم النداء');
    await parent.reload();
    await expect(parent.getByText('حان دورك الآن!')).toBeVisible();

    await calledCard.getByRole('button', { name: 'بدء الكشف' }).click();
    await expect(calledCard).toContainText('في الكشف');

    const doctor = await doctorContext.newPage();
    await signIn(doctor, `${dashboardUrl}/sign-in`, fixture.doctor);
    await doctor.goto(`${dashboardUrl}/queue`);
    const inService = doctor.locator(
      `.now__patient[data-appointment-id="${appointmentId}"]`,
    );
    await inService.getByRole('link', { name: 'فتح جلسة الكشف' }).click();
    await doctor
      .getByLabel('التشخيص والملاحظات السريرية')
      .fill('تشخيص رحلة Dashboard الآلية');
    await doctor
      .getByLabel('تعليمات العلاج')
      .fill('سوائل وراحة ومتابعة الأعراض.');
    await doctor
      .getByLabel('ملخص مبسط للأهل')
      .fill('تم الكشف والحالة مستقرة مع متابعة الأعراض.');
    await doctor.getByRole('button', { name: 'إنهاء الزيارة' }).click();
    await doctor.getByRole('button', { name: 'تأكيد إنهاء الزيارة' }).click();
    await expect(
      doctor.getByRole('button', { name: 'تم إنهاء الزيارة' }),
    ).toBeVisible();

    await reception.goto(`${dashboardUrl}/payments`);
    await reception.getByRole('button', { name: 'تسجيل دفعة' }).click();
    await reception.getByLabel('الموعد').selectOption({ value: appointmentId });
    await reception.getByLabel('المبلغ بالجنيه').fill('350');
    await reception.getByRole('button', { name: 'حفظ' }).click();
    const paymentRow = reception.locator('.payment-row', {
      hasText: fixture.childName,
    });
    await expect(paymentRow).toContainText('مدفوع');

    await reception.goto(`${dashboardUrl}/reports`);
    await expect(reception.getByText('إجمالي المواعيد')).toBeVisible();
    await expect(reception.getByText('الإيراد المحصل')).toHaveCount(0);
    await expectAccessible(reception);

    await doctor.goto(`${dashboardUrl}/reports`);
    await expect(doctor.getByText('الإيراد المحصل')).toBeVisible();
    await expectAccessible(doctor);
    const sidebar = doctor.locator('.dash-side');
    const sidebarLayout = await sidebar.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        position: style.position,
        overflowY: style.overflowY,
        viewportHeight: element.clientHeight,
        contentHeight: element.scrollHeight,
      };
    });
    expect(sidebarLayout.position).toBe('fixed');
    expect(sidebarLayout.overflowY).toBe('hidden');
    expect(sidebarLayout.contentHeight).toBeLessThanOrEqual(
      sidebarLayout.viewportHeight,
    );
    await expect(sidebar).toHaveScreenshot('doctor-sidebar.png', {
      animations: 'disabled',
    });

    await parent.goto(`${mobileUrl}/appointments/${appointmentId}`);
    await expect(parent.getByText('تمت الزيارة')).toBeVisible();
  } finally {
    await Promise.all([
      parentContext.close(),
      receptionContext.close(),
      doctorContext.close(),
    ]);
  }
});
