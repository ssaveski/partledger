import { translate } from '@partledger/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CopyIcon, PlusIcon } from 'lucide-react';

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

export const Buttons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>{translate('pl.ui.preview.save')}</Button>
      <Button variant="secondary">{translate('pl.ui.preview.cancel')}</Button>
      <Button variant="ghost">
        <PlusIcon aria-hidden />
        {translate('pl.ui.preview.addPart')}
      </Button>
      <Button variant="danger">{translate('pl.ui.preview.deleteSupplier')}</Button>
      <Button size="sm" variant="secondary">
        {translate('pl.ui.preview.importParts')}
      </Button>
      <Button size="icon" variant="secondary" aria-label={translate('pl.ui.preview.copyPartNumber')}>
        <CopyIcon aria-hidden />
      </Button>
      <Button disabled>{translate('pl.ui.preview.save')}</Button>
    </div>
  ),
};

export const Inputs: Story = {
  render: () => (
    <div className="grid max-w-md gap-5">
      <Field>
        <FieldLabel>{translate('pl.ui.preview.partNumber')}</FieldLabel>
        <Input defaultValue={samplePart.number} className="font-mono" />
        <FieldDescription>{translate('pl.ui.preview.partNumberHint')}</FieldDescription>
      </Field>
      <Field invalid>
        <FieldLabel>{translate('pl.ui.preview.partNumber')}</FieldLabel>
        <Input required aria-invalid />
        <FieldError match>{translate('pl.ui.preview.partNumberError')}</FieldError>
      </Field>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="preview-notes">{translate('pl.ui.preview.notes')}</Label>
        <Textarea id="preview-notes" />
      </div>
      <Field disabled>
        <FieldLabel>{translate('pl.ui.preview.quantity')}</FieldLabel>
        <Input defaultValue={samplePart.quantity} className="font-mono" />
      </Field>
    </div>
  ),
};

export const ChecksAndSwitches: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Label className="flex items-center gap-2">
        <Checkbox defaultChecked />
        {translate('pl.ui.preview.notifySuppliers')}
      </Label>
      <Label className="flex items-center gap-2">
        <Checkbox />
        {translate('pl.ui.preview.notifySuppliers')}
      </Label>
      <Label className="flex items-center gap-2">
        <Switch defaultChecked />
        {translate('pl.ui.preview.showArchived')}
      </Label>
      <Label className="flex items-center gap-2">
        <Switch />
        {translate('pl.ui.preview.showArchived')}
      </Label>
    </div>
  ),
};

function SupplierSelect({ open }: { open: boolean }) {
  return (
    <Field className="max-w-xs">
      <Select items={sampleSuppliers} defaultOpen={open}>
        <FieldLabel>{translate('pl.ui.preview.supplier')}</FieldLabel>
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

export const DialogOpen: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger>{translate('pl.ui.preview.deleteSupplier')}</DialogTrigger>
      <DialogContent>
        <DialogTitle>{translate('pl.ui.preview.deleteTitle')}</DialogTitle>
        <DialogDescription>{translate('pl.ui.preview.deleteDescription')}</DialogDescription>
        <DialogFooter>
          <DialogClose>{translate('pl.ui.preview.cancel')}</DialogClose>
          <Button variant="danger">{translate('pl.ui.preview.deleteSupplier')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const TabsPreview: Story = {
  name: 'Tabs',
  render: () => (
    <Tabs defaultValue="overview" className="max-w-lg">
      <TabsList>
        <Tab value="overview">{translate('pl.ui.preview.overview')}</Tab>
        <Tab value="quotes">{translate('pl.ui.preview.quotes')}</Tab>
        <Tab value="evidence">{translate('pl.ui.preview.evidence')}</Tab>
      </TabsList>
      <TabsPanel value="overview">{translate('pl.ui.preview.overviewBody')}</TabsPanel>
      <TabsPanel value="quotes">{translate('pl.ui.preview.quotesBody')}</TabsPanel>
      <TabsPanel value="evidence">{translate('pl.ui.preview.evidenceBody')}</TabsPanel>
    </Tabs>
  ),
};

export const TooltipOpen: Story = {
  tags: ['body-portal'],
  render: () => (
    <div className="pt-12">
      <Tooltip defaultOpen>
        <TooltipTrigger
          render={<Button size="icon" variant="secondary" aria-label={translate('pl.ui.preview.copyPartNumber')} />}
        >
          <CopyIcon aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{translate('pl.ui.preview.copyPartNumber')}</TooltipContent>
      </Tooltip>
    </div>
  ),
};

export const Display: Story = {
  render: () => (
    <div className="grid max-w-lg gap-5">
      <div className="flex flex-wrap gap-2">
        <Badge>{translate('pl.ui.preview.draft')}</Badge>
        <Badge tone="accent">{translate('pl.ui.preview.quoted')}</Badge>
        <Badge tone="success">{translate('pl.ui.preview.approved')}</Badge>
        <Badge tone="warning">{translate('pl.ui.preview.pending')}</Badge>
        <Badge tone="danger">{translate('pl.ui.preview.expired')}</Badge>
        <Badge tone="info">{translate('pl.ui.preview.aiSuggestion')}</Badge>
      </div>
      <Card>
        <CardTitle>{translate('pl.ui.preview.partTitle')}</CardTitle>
        <CardDescription>{translate('pl.ui.preview.partDescription')}</CardDescription>
        <Separator />
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">{translate('pl.ui.preview.partNumber')}</dt>
          <dd>
            <Mono>{samplePart.number}</Mono>
          </dd>
          <dt className="text-muted">{translate('pl.ui.preview.unitPrice')}</dt>
          <dd>
            <Mono>{samplePart.unitPrice}</Mono>
          </dd>
          <dt className="text-muted">{translate('pl.ui.preview.quantity')}</dt>
          <dd>
            <Mono>{samplePart.quantity}</Mono>
          </dd>
        </dl>
      </Card>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  ),
};
