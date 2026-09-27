import type { MessageParams } from '@partledger/contracts';
import { useTranslate } from '@partledger/ui';
import { useEffect } from 'react';

/** Names the page in the browser tab and for assistive technology (WCAG 2.4.2). */
export function useDocumentTitle(key: string, params?: MessageParams, enabled = true): void {
  const translate = useTranslate();
  const title = translate('pl.portal.documentTitle', { page: translate(key, params) });
  useEffect(() => {
    if (enabled) {
      document.title = title;
    }
  }, [title, enabled]);
}
