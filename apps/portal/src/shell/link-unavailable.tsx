import { useTranslate } from '@partledger/ui';
import { LinkIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useDocumentTitle } from './document-title';

/**
 * A wrong secret, an expired link, a revoked link and an ended session all get the API's one
 * uniform 401 (KTD21), so they share this state. Retrying cannot help, so it offers none: only
 * the buyer can send a new link.
 */
export function LinkUnavailableState() {
  const translate = useTranslate();
  const heading = useRef<HTMLHeadingElement>(null);
  useDocumentTitle('pl.portal.linkUnavailable.title');
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center text-primary">
      <LinkIcon aria-hidden className="size-8 text-muted" />
      <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-hidden">
        {translate('pl.portal.linkUnavailable.title')}
      </h1>
      <p className="max-w-prose text-muted">{translate('pl.portal.linkUnavailable.description')}</p>
      <p className="max-w-prose text-sm text-muted">{translate('pl.portal.linkUnavailable.nextStep')}</p>
    </div>
  );
}
