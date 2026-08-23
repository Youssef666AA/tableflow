import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plug, ShieldCheck } from 'lucide-react';
import { DAY_NAMES } from '@tableflow/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { titleCase } from '@/lib/format';
import { Badge, Button, Field, Input, SegmentedControl, Select, Spinner, Switch } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';
import { Page, PageHeading, SectionHeading } from '@/console/PageShell';
import type { AdminBranch, AdminSettingsPayload } from '../types';

type Tab = 'restaurant' | 'branch' | 'system';

export default function SettingsPage() {
  const { branchId, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('restaurant');

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AdminSettingsPayload>('/settings'),
  });

  const data = query.data;
  const branch = data?.branches.find((item) => item.id === branchId) ?? data?.branches[0];

  return (
    <Page width="narrow">
      <PageHeading
        title="Settings"
        description="Charges, service radius, kitchen behaviour and integrations."
        actions={
          <SegmentedControl
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'restaurant', label: 'Restaurant' },
              { value: 'branch', label: 'Branch' },
              { value: 'system', label: 'System' },
            ]}
          />
        }
      />

      {query.isLoading && (
        <div className="flex h-52 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      )}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {data && tab === 'restaurant' && (
        <RestaurantSettings
          settings={data}
          editable={can('settings:manage')}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['settings'] })}
        />
      )}

      {data && branch && tab === 'branch' && (
        <BranchSettings
          branch={branch}
          editable={can('settings:manage')}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['settings'] });
            toast.success('Branch settings saved');
          }}
        />
      )}

      {data && tab === 'system' && <SystemPanel settings={data} />}
    </Page>
  );
}

/* ------------------------------------------------------ Restaurant panel */

function RestaurantSettings({
  settings,
  editable,
  onSaved,
}: {
  settings: AdminSettingsPayload;
  editable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const restaurant = settings.restaurant;

  const [name, setName] = useState(restaurant.name);
  const [legalName, setLegalName] = useState(restaurant.legalName ?? '');
  const [currency, setCurrency] = useState(restaurant.currency);
  const [taxRate, setTaxRate] = useState((restaurant.taxRateBps / 100).toString());
  const [serviceRate, setServiceRate] = useState((restaurant.serviceChargeRateBps / 100).toString());
  const [pricesIncludeTax, setPricesIncludeTax] = useState(restaurant.pricesIncludeTax);

  const save = useMutation({
    mutationFn: () =>
      api.put('/settings', {
        name: name.trim(),
        legalName: legalName.trim() || null,
        currency,
        taxRateBps: Math.round(Number(taxRate) * 100),
        serviceChargeRateBps: Math.round(Number(serviceRate) * 100),
        pricesIncludeTax,
      }),
    onSuccess: () => {
      onSaved();
      toast.success('Restaurant settings saved');
    },
    onError: (error) =>
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading title="Profile" description="How the restaurant appears to guests." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="s-name" className="sm:col-span-2">
            <Input id="s-name" value={name} onChange={(event) => setName(event.target.value)} disabled={!editable} />
          </Field>
          <Field label="Legal name" htmlFor="s-legal" hint="on receipts" className="sm:col-span-2">
            <Input
              id="s-legal"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              disabled={!editable}
            />
          </Field>
          <Field label="Currency" htmlFor="s-currency">
            <Select
              id="s-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              disabled={!editable}
            >
              <option value="TND">TND — Tunisian dinar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="USD">USD — US dollar</option>
              <option value="GBP">GBP — Pound sterling</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <p className="text-xs leading-relaxed text-ink-muted">
              {restaurant.productCount} products across {restaurant.categoryCount} categories.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading
          title="Tax and service charge"
          description="Applied by the pricing engine on every order and receipt."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="VAT rate (%)" htmlFor="s-tax">
            <Input
              id="s-tax"
              inputMode="decimal"
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
              className="tabular"
              disabled={!editable}
            />
          </Field>
          <Field label="Service charge (%)" htmlFor="s-service">
            <Input
              id="s-service"
              inputMode="decimal"
              value={serviceRate}
              onChange={(event) => setServiceRate(event.target.value)}
              className="tabular"
              disabled={!editable}
            />
          </Field>
          <div className="sm:col-span-2">
            <Switch
              checked={pricesIncludeTax}
              onChange={setPricesIncludeTax}
              disabled={!editable}
              label="Menu prices include VAT"
              description="When on, the price a guest sees is the price they pay and VAT is extracted for the receipt breakdown."
            />
          </div>
        </div>
      </section>

      {editable && (
        <div className="flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save restaurant settings
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- Branch panel */

function BranchSettings({
  branch,
  editable,
  onSaved,
}: {
  branch: AdminBranch;
  editable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(branch);

  useEffect(() => setDraft(branch), [branch]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/settings/branches/${branch.id}`, {
        name: draft.name,
        address: draft.address,
        phone: draft.phone,
        latitude: draft.latitude,
        longitude: draft.longitude,
        serviceRadiusMeters: draft.serviceRadiusMeters,
        requireLocation: draft.requireLocation,
        allowStaffLocationOverride: draft.allowStaffLocationOverride,
        sessionTtlMinutes: draft.sessionTtlMinutes,
        maxActiveOrdersPerSession: draft.maxActiveOrdersPerSession,
        allowNegativeStock: draft.allowNegativeStock,
        deductStockOn: draft.deductStockOn,
        splitStationsEnabled: draft.splitStationsEnabled,
        autoAcceptOrders: draft.autoAcceptOrders,
        kitchenSlaMinutes: draft.kitchenSlaMinutes,
        openingHours: draft.openingHours,
      }),
    onSuccess: onSaved,
    onError: (error) =>
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const set = <K extends keyof AdminBranch>(key: K, value: AdminBranch[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const hours =
    draft.openingHours.length === 7
      ? draft.openingHours
      : Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          opensAt: '08:00',
          closesAt: '23:30',
          closed: false,
        }));

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading title={draft.name} description="Branch profile" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="b-name" className="sm:col-span-2">
            <Input id="b-name" value={draft.name} onChange={(event) => set('name', event.target.value)} disabled={!editable} />
          </Field>
          <Field label="Address" htmlFor="b-address" className="sm:col-span-2">
            <Input
              id="b-address"
              value={draft.address ?? ''}
              onChange={(event) => set('address', event.target.value)}
              disabled={!editable}
            />
          </Field>
          <Field label="Phone" htmlFor="b-phone">
            <Input
              id="b-phone"
              value={draft.phone ?? ''}
              onChange={(event) => set('phone', event.target.value)}
              disabled={!editable}
            />
          </Field>
          <Field label="Timezone" htmlFor="b-tz">
            <Input id="b-tz" value={draft.timezone} disabled className="tabular" />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading
          title="Location gate"
          description="Guests must be near the restaurant before they can order."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Latitude" htmlFor="b-lat">
            <Input
              id="b-lat"
              inputMode="decimal"
              value={draft.latitude}
              onChange={(event) => set('latitude', Number(event.target.value))}
              className="tabular"
              disabled={!editable}
            />
          </Field>
          <Field label="Longitude" htmlFor="b-lng">
            <Input
              id="b-lng"
              inputMode="decimal"
              value={draft.longitude}
              onChange={(event) => set('longitude', Number(event.target.value))}
              className="tabular"
              disabled={!editable}
            />
          </Field>
          <Field label="Service radius (metres)" htmlFor="b-radius" className="sm:col-span-2">
            <Input
              id="b-radius"
              type="number"
              min={10}
              max={20000}
              value={draft.serviceRadiusMeters}
              onChange={(event) => set('serviceRadiusMeters', Number(event.target.value))}
              className="tabular"
              disabled={!editable}
            />
          </Field>
          <div className="space-y-3 sm:col-span-2">
            <Switch
              checked={draft.requireLocation}
              onChange={(value) => set('requireLocation', value)}
              disabled={!editable}
              label="Require location verification"
              description="Turning this off lets anyone with the QR link order from anywhere."
            />
            <Switch
              checked={draft.allowStaffLocationOverride}
              onChange={(value) => set('allowStaffLocationOverride', value)}
              disabled={!editable}
              label="Allow staff to vouch for a table"
              description="A fallback for guests whose GPS will not cooperate."
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading title="Orders and sessions" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Session length (minutes)" htmlFor="b-ttl" description="Extended automatically while guests order.">
            <Input
              id="b-ttl"
              type="number"
              min={15}
              max={1440}
              value={draft.sessionTtlMinutes}
              onChange={(event) => set('sessionTtlMinutes', Number(event.target.value))}
              className="tabular"
              disabled={!editable}
            />
          </Field>
          <Field label="Max orders in progress" htmlFor="b-max" description="Per table session.">
            <Input
              id="b-max"
              type="number"
              min={1}
              max={50}
              value={draft.maxActiveOrdersPerSession}
              onChange={(event) => set('maxActiveOrdersPerSession', Number(event.target.value))}
              className="tabular"
              disabled={!editable}
            />
          </Field>
          <Field label="Kitchen target (minutes)" htmlFor="b-sla" description="Tickets turn amber then red past this.">
            <Input
              id="b-sla"
              type="number"
              min={1}
              max={240}
              value={draft.kitchenSlaMinutes}
              onChange={(event) => set('kitchenSlaMinutes', Number(event.target.value))}
              className="tabular"
              disabled={!editable}
            />
          </Field>
          <Field label="Deduct stock" htmlFor="b-deduct">
            <Select
              id="b-deduct"
              value={draft.deductStockOn}
              onChange={(event) => set('deductStockOn', event.target.value as AdminBranch['deductStockOn'])}
              disabled={!editable}
            >
              <option value="ORDER_CREATED">When the order is placed</option>
              <option value="ORDER_COMPLETED">When the order is completed</option>
            </Select>
          </Field>
          <div className="space-y-3 sm:col-span-2">
            <Switch
              checked={draft.autoAcceptOrders}
              onChange={(value) => set('autoAcceptOrders', value)}
              disabled={!editable}
              label="Auto-accept orders"
              description="Skip the kitchen's accept step and go straight to the queue."
            />
            <Switch
              checked={draft.splitStationsEnabled}
              onChange={(value) => set('splitStationsEnabled', value)}
              disabled={!editable}
              label="Route items to kitchen stations"
              description="Pizza, grill and drinks each get their own queue."
            />
            <Switch
              checked={draft.allowNegativeStock}
              onChange={(value) => set('allowNegativeStock', value)}
              disabled={!editable}
              label="Allow negative stock"
              description="Off by default — orders are refused when an ingredient runs out."
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading title="Opening hours" description="Guests cannot place orders outside these hours." />
        <div className="space-y-2">
          {hours.map((hour, index) => (
            <div key={hour.dayOfWeek} className="flex flex-wrap items-center gap-3">
              <span className="w-24 shrink-0 text-sm text-ink-soft">{DAY_NAMES[hour.dayOfWeek]}</span>
              <Input
                type="time"
                value={hour.opensAt}
                disabled={!editable || hour.closed}
                onChange={(event) => {
                  const next = [...hours];
                  next[index] = { ...hour, opensAt: event.target.value };
                  set('openingHours', next);
                }}
                className="w-32"
                aria-label={`${DAY_NAMES[hour.dayOfWeek]} opening time`}
              />
              <span className="text-ink-muted">–</span>
              <Input
                type="time"
                value={hour.closesAt}
                disabled={!editable || hour.closed}
                onChange={(event) => {
                  const next = [...hours];
                  next[index] = { ...hour, closesAt: event.target.value };
                  set('openingHours', next);
                }}
                className="w-32"
                aria-label={`${DAY_NAMES[hour.dayOfWeek]} closing time`}
              />
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={hour.closed}
                  disabled={!editable}
                  onChange={(event) => {
                    const next = [...hours];
                    next[index] = { ...hour, closed: event.target.checked };
                    set('openingHours', next);
                  }}
                  className="size-4 rounded border-line-strong text-accent focus:ring-accent/40"
                />
                Closed
              </label>
            </div>
          ))}
        </div>
      </section>

      {editable && (
        <div className="flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save branch settings
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- System panel */

function SystemPanel({ settings }: { settings: AdminSettingsPayload }) {
  const system = settings.system;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading title="Runtime" description="What this instance is running." />
        <dl className="grid gap-4 sm:grid-cols-2">
          <Row label="Environment" value={titleCase(system.environment)} />
          <Row
            label="Demo mode"
            value={
              <Badge tone={system.demoMode ? 'warning' : 'neutral'} size="sm">
                {system.demoMode ? 'On — dev tools exposed' : 'Off'}
              </Badge>
            }
          />
          <Row
            label="Background jobs"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Badge tone={system.queueDriver === 'redis' ? 'success' : 'neutral'} size="sm">
                  {system.queueDriver === 'redis' ? 'Redis / BullMQ' : 'In-process scheduler'}
                </Badge>
              </span>
            }
          />
          <Row label="Branches" value={String(settings.branches.length)} />
        </dl>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading title="Payment providers" description="What the billing screens can offer." />
        <ul className="space-y-2">
          {system.paymentProviders.map((provider) => (
            <li
              key={provider.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line px-3.5 py-2.5"
            >
              <span className="text-sm text-ink">{provider.displayName}</span>
              <Badge tone={provider.simulated ? 'warning' : 'success'} size="sm">
                {provider.simulated ? 'Simulated' : 'Live'}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          The bundled provider is a real state machine over this database, but it never contacts a card
          network. Cash and card-terminal payments are recorded by staff after collecting them.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading
          title="Optional integrations"
          description="All off by default — TableFlow needs no external API key to run."
        />
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(system.integrations).map(([key, enabled]) => (
            <li
              key={key}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border px-3.5 py-2.5',
                enabled ? 'border-accent/30 bg-accent-soft/40' : 'border-line',
              )}
            >
              <span className="inline-flex items-center gap-2 text-sm text-ink">
                <Plug className="size-3.5 text-ink-muted" aria-hidden />
                {titleCase(key)}
              </span>
              <Badge tone={enabled ? 'success' : 'neutral'} size="sm">
                {enabled ? 'Enabled' : 'Not configured'}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <SectionHeading title="Branches" />
        <ul className="space-y-2">
          {settings.branches.map((branch) => (
            <li key={branch.id} className="flex items-start gap-3 rounded-md border border-line px-3.5 py-3">
              <Building2 className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{branch.name}</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">{branch.address ?? 'No address'}</p>
              </div>
              <div className="shrink-0 text-right text-2xs text-ink-muted">
                <p>{branch._count?.tables ?? 0} tables</p>
                <p>{branch._count?.inventoryItems ?? 0} ingredients</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}
