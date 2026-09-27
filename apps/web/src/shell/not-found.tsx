import { buttonVariants, EmptyState, useTranslate } from '@partledger/ui';
import { Link } from '@tanstack/react-router';

import { useDocumentTitle } from './document-title';

export function NotFoundPage() {
  const translate = useTranslate();
  useDocumentTitle('pl.web.notFound.title');
  return (
    <EmptyState
      headingLevel={1}
      titleKey="pl.web.notFound.title"
      descriptionKey="pl.web.notFound.description"
      action={
        <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
          {translate('pl.web.notFound.action')}
        </Link>
      }
    />
  );
}
