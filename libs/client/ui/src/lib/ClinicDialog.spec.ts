import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import ClinicDialog from './ClinicDialog.vue';

/**
 * The behaviour both apps are relying on this component to get right.
 *
 * Everything asserted here is something a screen would otherwise have to
 * remember for itself, and would eventually forget in one of the two apps.
 */
describe('ClinicDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  const open = (props: Record<string, unknown> = {}, slots = {}) =>
    mount(ClinicDialog, {
      props: { open: true, title: 'إنهاء اليوم', ...props },
      slots,
      attachTo: document.body,
    });

  it('renders nothing at all while closed', () => {
    open({ open: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('announces itself as a modal named by its title', () => {
    open();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('إنهاء اليوم');
  });

  it('shows the subject, so nobody answers about the wrong patient', () => {
    open({ subject: 'لين' });
    expect(document.body.textContent).toContain('لين');
  });

  it('closes on the scrim and on Escape', async () => {
    const wrapper = open();

    document
      .querySelector('.cd-scrim')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);

    document
      .querySelector('[role="dialog"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(2);
  });

  it('refuses both when it must be answered', async () => {
    const wrapper = open({ persistent: true });

    document
      .querySelector('.cd-scrim')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document
      .querySelector('[role="dialog"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    await nextTick();

    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('takes focus itself rather than landing on a button', async () => {
    // Focusing "confirm" would put the destructive answer one keypress away.
    open({}, { actions: () => h('button', { id: 'go' }, 'تأكيد') });
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(document.querySelector('.cd-panel'));
  });

  it('locks the page behind it, and gives it back', async () => {
    const wrapper = mount(ClinicDialog, {
      props: { open: false, title: 'x' },
      attachTo: document.body,
    });

    await wrapper.setProps({ open: true });
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');

    await wrapper.setProps({ open: false });
    await nextTick();
    expect(document.body.style.overflow).toBe('');
  });

  it('does not leave the page locked if it is torn down while open', async () => {
    const wrapper = open();
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');

    wrapper.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('returns focus to whatever opened it', async () => {
    const host = defineComponent({
      data: () => ({ open: false }),
      render() {
        return [
          h('button', { id: 'opener', onClick: () => (this.open = true) }, 'x'),
          h(ClinicDialog, {
            open: this.open,
            title: 'x',
            onClose: () => (this.open = false),
          }),
        ];
      },
    });
    const wrapper = mount(host, { attachTo: document.body });

    const opener = document.querySelector<HTMLButtonElement>('#opener');
    opener?.focus();
    await wrapper.find('#opener').trigger('click');
    await nextTick();
    await nextTick();
    expect(document.activeElement).not.toBe(opener);

    document
      .querySelector('.cd-scrim')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    // Whoever pressed the button is looking at where the button was.
    expect(document.activeElement).toBe(opener);
  });

  it('omits the action row entirely when a screen provides none', () => {
    open();
    expect(document.querySelector('.cd-actions')).toBeNull();
  });
});
