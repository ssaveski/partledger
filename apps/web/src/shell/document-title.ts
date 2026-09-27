import type { MessageParams } from '@partledger/contracts';
import { useTranslate } from '@partledger/ui';
import { useEffect } from 'react';

/** Names the page in the browser tab and for assistive technology (WCAG 2.4.2). */
export function useDocumentTitle(key: string, params?: MessageParams): void {
  const translate = useTranslate();
  const pageTitle = translate(key, params);
  const title = translate('pl.web.documentTitle', { page: pageTitle });
  useEffect(() => {
    document.title = title;
  }, [title]);
}
