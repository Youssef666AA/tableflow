import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, Tag } from 'lucide-react';
import { DAY_SHORT } from '@tableflow/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDate, money } from '@/lib/format';
import { Badge, Button, Field, Input, Select, Switch, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { SidePanel, useToast } from '@/components/ui/overlays';
import { Page, PageHeading } from '@/console/PageShell';
import type { AdminMenuPayload, AdminPromotion } from '../types';

interface Draft {
  name: string;
  description: string;
  type: 'PERCENTAGE' | 'FIXED';
  scope: 'ORDER' | 'PRODUCT' | 'CATEGORY';
  value: string;
  categoryIds: string[];
  minSubtotal: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  active: boolean;
  priority: string;
}

const EMPTY: Draft = {
  name: '',
  description: '',
  type: 'PERCENTAGE',
  scope: 'ORDER',
  value: '10',
  categoryIds: [],
  minSubtotal: '',
  daysOfWeek: [],
  startTime: '',
  endTime: '',
  active: true,
  priority: '0',
};

const toMinutes = (value: string) => {
  if (!value) return null;
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
};

const fromMinutes = (value: number | null) => {
  if (value == null) return '';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

export default function PromotionsPage() {
  const { currency, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPromotion | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const query = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api.get<{ promotions: AdminPromotion[] }>('/promotions'),
  });

  const menuQuery = useQuery({
    queryKey: ['menu', 'categories'],
    queryFn: () => api.get<AdminMenuPayload>('/menu'),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        type: draft.type,
        scope: draft.scope,
        value: draft.type === 'PERCENTAGE' ? Number(draft.value) : Math.round(Number(draft.value) * 1000),
        categoryIds: draft.scope === 'CATEGORY' ? draft.categoryIds : [],
        productIds: [],
        minSubtotal: draft.minSubtotal ? Math.round(Number(draft.minSubtotal) * 1000) : null,
        daysOfWeek: draft.daysOfWeek,
        startMinuteOfDay: toMinutes(draft.startTime),
        endMinuteOfDay: toMinutes(draft.endTime),
        active: draft.active,
        priority: Number(draft.priority) || 0,
      };
      return editing ? api.put(`/promotions/${editing.id}`, body) : api.post('/promotions', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setOpen(false);
      toast.success(editing ? 'Promotion updated' : 'Promotion created');
    },
    onError: (error) =>
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const archive = useMutation({
    mutationFn: () => api.del(`/promotions/${editing?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setOpen(false);
      toast.success('Promotion deactivated');
    },
  });

  const openEditor = (promotion: AdminPromotion | null) => {
    setEditing(promotion);
    setDraft(
      promotion
        ? {
            name: promotion.name,
            description: promotion.description ?? '',
            type: promotion.type,
            scope: promotion.scope,
            value:
              promotion.type === 'PERCENTAGE'
                ? String(promotion.value)
                : (promotion.value / 1000).toFixed(3),
            categoryIds: promotion.categoryIds,
            minSubtotal: promotion.minSubtotal ? (promotion.minSubtotal / 1000).toFixed(3) : '',
            daysOfWeek: promotion.daysOfWeek,
            startTime: fromMinutes(promotion.startMinuteOfDay),
            endTime: fromMinutes(promotion.endMinuteOfDay),
            active: promotion.active,
            priority: String(promotion.priority),
          }
        : EMPTY,
    );
    setOpen(true);
  };

  const promotions = query.data?.promotions ?? [];

  return (
    <Page width="narrow">
      <PageHeading
        title="Promotions"
        description="Discounts are validated and applied by the server at order time, never by the guest's device."
        actions={
          can('promotions:manage') && (
            <Button leadingIcon={<Plus className="size-4" />} onClick={() => openEditor(null)}>
              New promotion
            </Button>
          )
        }
      />

      {query.isLoading && <LoadingRows rows={3} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && promotions.length === 0 && (
        <EmptyState
          icon={<Tag className="size-5" />}
          title="No promotions yet"
          description="Create a happy hour, a lunch deal or a spend threshold."
          action={can('promotions:manage') && <Button onClick={() => openEditor(null)}>Create one</Button>}
        />
      )}

      <div className="space-y-3">
        {promotions.map((promotion) => (
          <button
            key={promotion.id}
            onClick={() => can('promotions:manage') && openEditor(promotion)}
            disabled={!can('promotions:manage')}
            className={cn(
              'w-full rounded-lg border bg-surface p-4 text-left shadow-subtle transition-all',
              can('promotions:manage') && 'hover:shadow-lift',
              promotion.active ? 'border-line' : 'border-line opacity-60',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[0.9375rem] font-semibold text-ink">{promotion.name}</h3>
                  <Badge tone={promotion.active ? 'success' : 'neutral'} size="sm" dot>
                    {promotion.active ? 'Live' : 'Paused'}
                  </Badge>
                </div>
                {promotion.description && (
                  <p className="mt-1 text-sm text-ink-muted">{promotion.description}</p>
                )}
              </div>
              <p className="tabular shrink-0 font-display text-xl font-semibold text-accent-strong">
                {promotion.type === 'PERCENTAGE'
                  ? `${promotion.value}%`
                  : money(promotion.value, currency)}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-ink-muted">
              <Badge size="sm">{promotion.scope.toLowerCase()}</Badge>
              {promotion.branch && <Badge size="sm">{promotion.branch.name}</Badge>}
              {promotion.minSubtotal && (
                <span>over {money(promotion.minSubtotal, currency)}</span>
              )}
              {promotion.daysOfWeek.length > 0 && (
                <span>{promotion.daysOfWeek.map((day) => DAY_SHORT[day]).join(', ')}</span>
              )}
              {promotion.startMinuteOfDay != null && (
                <span>
                  {fromMinutes(promotion.startMinuteOfDay)}–{fromMinutes(promotion.endMinuteOfDay)}
                </span>
              )}
              {promotion.startsAt && <span>from {formatDate(promotion.startsAt)}</span>}
              <span className="ml-auto">{promotion.usageCount} uses</span>
            </div>
          </button>
        ))}
      </div>

      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        width="sm"
        title={editing ? editing.name : 'New promotion'}
        description="The engine picks the highest-priority applicable rule first."
        footer={
          <div className="flex items-center justify-between gap-3">
            {editing && (
              <Button variant="ghost" size="sm" loading={archive.isPending} onClick={() => archive.mutate()}>
                Deactivate
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="pr-name" required>
            <Input
              id="pr-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Happy Hour"
            />
          </Field>

          <Field label="Description" htmlFor="pr-description" hint="optional">
            <Textarea
              id="pr-description"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              rows={2}
              placeholder="20% off every drink between 14:00 and 17:00."
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount type" htmlFor="pr-type">
              <Select
                id="pr-type"
                value={draft.type}
                onChange={(event) => setDraft({ ...draft, type: event.target.value as Draft['type'] })}
              >
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </Select>
            </Field>
            <Field label={draft.type === 'PERCENTAGE' ? 'Percent off' : `Amount (${currency})`} htmlFor="pr-value">
              <Input
                id="pr-value"
                inputMode="decimal"
                value={draft.value}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                className="tabular"
              />
            </Field>
          </div>

          <Field label="Applies to" htmlFor="pr-scope">
            <Select
              id="pr-scope"
              value={draft.scope}
              onChange={(event) => setDraft({ ...draft, scope: event.target.value as Draft['scope'] })}
            >
              <option value="ORDER">The whole order</option>
              <option value="CATEGORY">Selected categories</option>
            </Select>
          </Field>

          {draft.scope === 'CATEGORY' && (
            <Field label="Categories">
              <div className="space-y-1.5">
                {menuQuery.data?.categories.map((category) => (
                  <label key={category.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={draft.categoryIds.includes(category.id)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          categoryIds: event.target.checked
                            ? [...draft.categoryIds, category.id]
                            : draft.categoryIds.filter((id) => id !== category.id),
                        })
                      }
                      className="size-4 rounded border-line-strong text-accent focus:ring-accent/40"
                    />
                    {category.name}
                  </label>
                ))}
              </div>
            </Field>
          )}

          <Field label={`Minimum order (${currency})`} htmlFor="pr-min" hint="optional">
            <Input
              id="pr-min"
              inputMode="decimal"
              value={draft.minSubtotal}
              onChange={(event) => setDraft({ ...draft, minSubtotal: event.target.value })}
              className="tabular"
              placeholder="80.000"
            />
          </Field>

          <Field label="Days" description="Leave empty for every day">
            <div className="flex flex-wrap gap-1.5">
              {DAY_SHORT.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      daysOfWeek: draft.daysOfWeek.includes(day)
                        ? draft.daysOfWeek.filter((value) => value !== day)
                        : [...draft.daysOfWeek, day],
                    })
                  }
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    draft.daysOfWeek.includes(day)
                      ? 'border-accent bg-accent-soft text-accent-strong'
                      : 'border-line bg-surface text-ink-muted hover:text-ink-soft',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="pr-start" hint="optional">
              <Input
                id="pr-start"
                type="time"
                value={draft.startTime}
                onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
              />
            </Field>
            <Field label="Until" htmlFor="pr-end" hint="optional">
              <Input
                id="pr-end"
                type="time"
                value={draft.endTime}
                onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Priority" htmlFor="pr-priority" description="Higher runs first when several rules apply.">
            <Input
              id="pr-priority"
              type="number"
              min={0}
              max={100}
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
              className="tabular w-24"
            />
          </Field>

          <Switch
            checked={draft.active}
            onChange={(value) => setDraft({ ...draft, active: value })}
            label="Live"
            description="Inactive promotions are never applied."
          />

          <div className="flex items-start gap-2.5 rounded-md bg-surface-sunken px-3.5 py-3">
            <Percent className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <p className="text-xs leading-relaxed text-ink-muted">
              Discounts are recalculated on the server for every order and spread across lines, so receipts
              and split bills always add up.
            </p>
          </div>
        </div>
      </SidePanel>
    </Page>
  );
}
