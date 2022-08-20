import dayjs from 'dayjs';
import dayjslocalizedformat from 'dayjs/plugin/localizedFormat';
import dayjsrelative from 'dayjs/plugin/relativeTime';
import type { QuasarLanguage } from 'quasar';
import { Quasar } from 'quasar';
import type { I18n, I18nOptions } from 'vue-i18n';
import { createI18n } from 'vue-i18n';
import type en from '../en.json';
import { findLocale } from './findLocale';
import type { supportedLangsType } from './supportedLangs';

type MessageSchema = typeof en

export function setupI18n(options:I18nOptions<{ message: MessageSchema }, supportedLangsType>) {
  if(!options.globalInjection) options.globalInjection = true;
  const lang = findLocale(navigator.language);
  const i18n = createI18n<[MessageSchema], supportedLangsType>({
    locale: lang,
  });

  setI18nLanguage(i18n, lang);
  return i18n;
}

export function setI18nLanguage(i18n:I18n<unknown, unknown, unknown, string, true>, locale:string) {

  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  (import(`../${locale}.json`) as Promise<{default : typeof import('../en.json') }>).then(messages => {
    /** vue-i18n */
    i18n.global.locale = locale;
    i18n.global.setLocaleMessage(locale, messages.default);

    /** Quasar */
    const langList = import.meta.glob('../../../../../node_modules/quasar/lang/*.mjs');
    langList[ `../../../../../node_modules/quasar/lang/${ locale === 'en' ? 'en-US' : locale}.mjs` ]().then(lang  => {
        Quasar.lang.set((lang as {default: QuasarLanguage }).default);
    });

    /** dayjs */
    const list = import.meta.glob('../../../../../node_modules/dayjs/esm/locale/*.js');
    list[ `../../../../../node_modules/dayjs/esm/locale/${ locale }.js` ]().then((c) => {
      dayjs.locale((c as {default: ILocale}).default);
    });
    dayjs.extend(dayjsrelative);
    dayjs.extend(dayjslocalizedformat);

  });
}
