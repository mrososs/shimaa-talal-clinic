const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * Latin digits to Arabic-Indic, for display.
 *
 * The clinic reads ٢٤, not 24. This was first attempted as a font feature
 * (`font-feature-settings: 'anum'`), which renders as plain Latin digits in
 * every font this app actually ships with — the numbers looked fine in review
 * and wrong on screen.
 *
 * Display only. Never apply it to a value someone has to type back, or to
 * anything that will be parsed: `٠١٠` is not a phone number any API accepts.
 */
export function arabicDigits(value: string | number): string {
  return String(value).replace(
    /[0-9]/g,
    (digit) => ARABIC_INDIC[Number(digit)],
  );
}
