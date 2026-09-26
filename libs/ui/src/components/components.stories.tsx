import type { Meta, StoryObj } from '@storybook/react-vite';
import { CopyIcon, PlusIcon } from 'lucide-react';

import { useTranslate } from '../i18n/translation';
import { samplePart, sampleSuppliers } from '../preview/sample-data';
import { Button } from './button';
import { Checkbox, Switch } from './checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Badge, Card, CardDescription, CardTitle, Mono, Separator, Skeleton } from './display';
import { Field, FieldDescription, FieldError, FieldLabel, Label } from './field';
import { Input, Textarea } from './input';
import { Select, SelectContent, SelectItem, SelectTrigger } from './select';
import { Tab, Tabs, TabsList, TabsPanel } from './tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const meta = { title: 'Components' } satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function ButtonsPreview() {
  const translate = useTranslate();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>{translate('pl.preview.save')}</Button>
      <Button variant="secondary">{translate('pl.preview.cancel')}</Button>
      <Button variant="ghost">
        <PlusIcon aria-hidden />
        {translate('pl.preview.addPart')}
      </Button>
      <Button variant="danger">{translate('pl.preview.deleteSupplier')}</Button>
      <Button size="sm" variant="secondary">
        {translate('pl.preview.importParts')}
      </Button>
      <Button size="icon" variant="secondary" aria-label={translate('pl.preview.copyPartNumber')}>
        <CopyIcon aria-hidden />
      </Button>
      <Button disabled>{translate('pl.preview.save')}</Button>
    </div>
  );
}

export const Buttons: Story = { render: () => <ButtonsPreview /> };

function InputsPreview() {
  const translate = useTranslate();
  return (
    <div className="grid max-w-md gap-5">
      <Field>
        <FieldLabel>{translate('pl.preview.partNumber')}</FieldLabel>
        <Input defaultValue={samplePart.number} className="font-mono" />
        <FieldDescription>{translate('pl.preview.partNumberHint')}</FieldDescription>
      </Field>
      <Field invalid>
        <FieldLabel>{translate('pl.preview.partNumber')}</FieldLabel>
        <Input required />
        <FieldError match>{translate('pl.preview.partNumberError')}</FieldError>
      </Field>
      <Field invalid>
        <FieldLabel>{translate('pl.preview.notes')}</FieldLabel>
        <Textarea />
        <FieldDescription>{translate('pl.preview.notesHint')}</FieldDescription>
        <FieldError match>{translate('pl.preview.notesError')}</FieldError>
      </Field>
      <Field disabled>
        <FieldLabel>{translate('pl.preview.quantity')}</FieldLabel>
        <Input defaultValue={samplePart.quantity} className="font-mono" />
      </Field>
    </div>
  );
}

export const Inputs: Story = { render: () => <InputsPreview /> };

function ChecksAndSwitchesPreview() {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-4">
      <Label className="flex items-center gap-2">
        <Checkbox defaultChecked />
        {translate('pl.preview.notifySuppliers')}
      </Label>
      <Label className="flex items-center gap-2">
        <Checkbox />
        {translate('pl.preview.notifySuppliers')}
      </Label>
      <Label className="flex items-center gap-2">
        <Switch defaultChecked />
        {translate('pl.preview.showArchived')}
      </Label>
      <Label className="flex items-center gap-2">
        <Switch />
        {translate('pl.preview.showArchived')}
      </Label>
    </div>
  );
}

export const ChecksAndSwitches: Story = { render: () => <ChecksAndSwitchesPreview /> };

function SupplierSelect({ open }: { open: boolean }) {
  const translate = useTranslate();
  return (
    <Field className="max-w-xs">
      <Select items={sampleSuppliers} defaultOpen={open}>
        <FieldLabel>{translate('pl.preview.supplier')}</FieldLabel>
        <SelectTrigger />
        <SelectContent>
          {sampleSuppliers.map((supplier) => (
            <SelectItem key={supplier.value} value={supplier.value}>
              {supplier.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export const SelectClosed: Story = { render: () => <SupplierSelect open={false} /> };

export const SelectOpen: Story = { tags: ['body-portal'], render: () => <SupplierSelect open /> };

function DialogPreview() {
  const translate = useTranslate();
  return (
    <Dialog defaultOpen>
      <DialogTrigger>{translate('pl.preview.deleteSupplier')}</DialogTrigger>
      <DialogContent>
        <DialogTitle>{translate('pl.preview.deleteTitle')}</DialogTitle>
        <DialogDescription>{translate('pl.preview.deleteDescription')}</DialogDescription>
        <DialogFooter>
          <DialogClose>{translate('pl.preview.cancel')}</DialogClose>
          <Button variant="danger">{translate('pl.preview.deleteSupplier')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const DialogOpen: Story = { render: () => <DialogPreview /> };

function TabsPreviewContent() {
  const translate = useTranslate();
  return (
    <Tabs defaultValue="overview" className="max-w-lg">
      <TabsList>
        <Tab value="overview">{translate('pl.preview.overview')}</Tab>
        <Tab value="quotes">{translate('pl.preview.quotes')}</Tab>
        <Tab value="evidence">{translate('pl.preview.evidence')}</Tab>
      </TabsList>
      <TabsPanel value="overview">{translate('pl.preview.overviewBody')}</TabsPanel>
      <TabsPanel value="quotes">{translate('pl.preview.quotesBody')}</TabsPanel>
      <TabsPanel value="evidence">{translate('pl.preview.evidenceBody')}</TabsPanel>
    </Tabs>
  );
}

export const TabsPreview: Story = { name: 'Tabs', render: () => <TabsPreviewContent /> };

function TooltipPreview() {
  const translate = useTranslate();
  return (
    <div className="pt-12">
      <Tooltip defaultOpen>
        <TooltipTrigger
          render={<Button size="icon" variant="secondary" aria-label={translate('pl.preview.copyPartNumber')} />}
        >
          <CopyIcon aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{translate('pl.preview.copyPartNumber')}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export const TooltipOpen: Story = { tags: ['body-portal'], render: () => <TooltipPreview /> };

function DisplayPreview() {
  const translate = useTranslate();
  return (
    <div className="grid max-w-lg gap-5">
      <div className="flex flex-wrap gap-2">
        <Badge>{translate('pl.preview.draft')}</Badge>
        <Badge tone="accent">{translate('pl.preview.quoted')}</Badge>
        <Badge tone="success">{translate('pl.preview.approved')}</Badge>
        <Badge tone="warning">{translate('pl.preview.pending')}</Badge>
        <Badge tone="danger">{translate('pl.preview.expired')}</Badge>
        <Badge tone="info">{translate('pl.preview.aiSuggestion')}</Badge>
      </div>
      <Card>
        <CardTitle>{translate('pl.preview.partTitle')}</CardTitle>
        <CardDescription>{translate('pl.preview.partDescription')}</CardDescription>
        <Separator />
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">{translate('pl.preview.partNumber')}</dt>
          <dd>
            <Mono>{samplePart.number}</Mono>
          </dd>
          <dt className="text-muted">{translate('pl.preview.unitPrice')}</dt>
          <dd>
            <Mono>{samplePart.unitPrice}</Mono>
          </dd>
          <dt className="text-muted">{translate('pl.preview.quantity')}</dt>
          <dd>
            <Mono>{samplePart.quantity}</Mono>
          </dd>
        </dl>
        <div>
          <Button variant="secondary" size="sm">
            {translate('pl.preview.copyPartNumber')}
          </Button>
        </div>
      </Card>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

export const Display: Story = { render: () => <DisplayPreview /> };
