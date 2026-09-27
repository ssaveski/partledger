import {
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  useTranslate,
} from '@partledger/ui';
import { useState, type ReactNode } from 'react';

/** The filters above a list, announced as a search region. */
export function FilterBar({ labelKey, children }: { labelKey: string; children: ReactNode }) {
  const translate = useTranslate();
  return (
    <div role="search" aria-label={translate(labelKey)} className="flex flex-wrap items-end gap-3">
      {children}
    </div>
  );
}

/**
 * A text filter kept in the address. The field holds its own text, so typing never waits for the
 * router, and reports each change for the address to follow. A screen that clears the filters
 * gives the field a new `key`, so it starts again from the address.
 */
export function SearchFilter({
  labelKey,
  value,
  onChange,
  autoFocus = false,
}: {
  labelKey: string;
  value: string;
  onChange: (value: string) => void;
  /** After the filters are cleared, focus returns here, since the control that cleared them is gone. */
  autoFocus?: boolean;
}) {
  const translate = useTranslate();
  const [text, setText] = useState(value);
  return (
    <Field className="w-full max-w-sm">
      <FieldLabel>{translate(labelKey)}</FieldLabel>
      <Input
        type="search"
        autoFocus={autoFocus}
        value={text}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          onChange(next);
        }}
      />
    </Field>
  );
}

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export function SelectFilter({
  labelKey,
  value,
  options,
  onChange,
}: {
  labelKey: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
}) {
  const translate = useTranslate();
  return (
    <Field>
      <Select
        items={options}
        value={value}
        onValueChange={(next) => {
          onChange(typeof next === 'string' ? next : '');
        }}
      >
        <FieldLabel>{translate(labelKey)}</FieldLabel>
        <SelectTrigger className="w-56" />
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
