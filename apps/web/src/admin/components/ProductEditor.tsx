import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Button, Field, IconButton, Input, Select, Switch, Textarea } from '@/components/ui/primitives';
import { SidePanel, useToast } from '@/components/ui/overlays';
import type { AdminCategory, AdminProduct, AdminStation } from '../types';

interface DraftVariant {
  name: string;
  priceDelta: string;
  available: boolean;
}

interface DraftOption {
  name: string;
  priceDelta: string;
  available: boolean;
}

interface DraftGroup {
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  required: boolean;
  minSelect: number;
  maxSelect: string;
  options: DraftOption[];
}

interface Draft {
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string;
  basePrice: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN';
  featured: boolean;
  popular: boolean;
  prepTimeMinutes: string;
  kitchenStationId: string;
  allergens: string;
  tags: string;
  calories: string;
  variants: DraftVariant[];
  modifierGroups: DraftGroup[];
}

const EMPTY: Draft = {
  categoryId: '',
  name: '',
  description: '',
  imageUrl: '',
  basePrice: '',
  status: 'AVAILABLE',
  featured: false,
  popular: false,
  prepTimeMinutes: '10',
  kitchenStationId: '',
  allergens: '',
  tags: '',
  calories: '',
  variants: [],
  modifierGroups: [],
};

/** Millimes <-> a human "12.500" string, so the form never juggles integers. */
const toMajor = (minor: number) => (minor / 1000).toFixed(3);
const toMinor = (value: string) => Math.round(Number(value.replace(',', '.') || '0') * 1000);

function draftFrom(product: AdminProduct): Draft {
  return {
    categoryId: product.categoryId,
    name: product.name,
    description: product.description ?? '',
    imageUrl: product.imageUrl ?? '',
    basePrice: toMajor(product.basePrice),
    status: product.status,
    featured: product.featured,
    popular: product.popular,
    prepTimeMinutes: String(product.prepTimeMinutes),
    kitchenStationId: product.kitchenStation?.id ?? '',
    allergens: product.allergens.join(', '),
    tags: product.tags.join(', '),
    calories: product.calories != null ? String(product.calories) : '',
    variants: product.variants.map((variant) => ({
      name: variant.name,
      priceDelta: toMajor(variant.priceDelta),
      available: variant.available,
    })),
    modifierGroups: product.modifierGroups.map((group) => ({
      name: group.name,
      selectionType: group.selectionType,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect != null ? String(group.maxSelect) : '',
      options: group.options.map((option) => ({
        name: option.name,
        priceDelta: toMajor(option.priceDelta),
        available: option.available,
      })),
    })),
  };
}

export function ProductEditor({
  product,
  open,
  onClose,
  categories,
  stations,
}: {
  product: AdminProduct | null;
  open: boolean;
  onClose: () => void;
  categories: AdminCategory[];
  stations: AdminStation[];
}) {
  const { currency, branchId } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setDraft(product ? draftFrom(product) : { ...EMPTY, categoryId: categories[0]?.id ?? '' });
  }, [open, product, categories]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        categoryId: draft.categoryId,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        imageUrl: draft.imageUrl.trim() || null,
        basePrice: toMinor(draft.basePrice),
        status: draft.status,
        featured: draft.featured,
        popular: draft.popular,
        prepTimeMinutes: Number(draft.prepTimeMinutes) || 10,
        kitchenStationId: draft.kitchenStationId || null,
        allergens: draft.allergens
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
        tags: draft.tags
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
        calories: draft.calories ? Number(draft.calories) : null,
        sortOrder: product?.sortOrder ?? 0,
        variants: draft.variants.map((variant, index) => ({
          name: variant.name.trim(),
          priceDelta: toMinor(variant.priceDelta),
          available: variant.available,
          sortOrder: index,
        })),
        modifierGroups: draft.modifierGroups.map((group, index) => ({
          name: group.name.trim(),
          selectionType: group.selectionType,
          required: group.required,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect ? Number(group.maxSelect) : null,
          sortOrder: index,
          options: group.options.map((option, optionIndex) => ({
            name: option.name.trim(),
            priceDelta: toMinor(option.priceDelta),
            available: option.available,
            sortOrder: optionIndex,
          })),
        })),
      };

      return product
        ? api.put(`/menu/products/${product.id}?branchId=${branchId}`, body)
        : api.post(`/menu/products?branchId=${branchId}`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      toast.success(product ? 'Item updated' : 'Item added to the menu');
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldIssues.length > 0) {
        setErrors(
          Object.fromEntries(error.fieldIssues.map((issue) => [issue.field, issue.message])),
        );
        toast.error('Please check the highlighted fields');
      } else {
        toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.');
      }
    },
  });

  const archive = useMutation({
    mutationFn: () => api.del(`/menu/products/${product?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      toast.success('Item archived', 'Past orders keep their history.');
      onClose();
    },
    onError: (error) =>
      toast.error('Could not archive', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      width="lg"
      title={product ? `Edit ${product.name}` : 'New menu item'}
      description={product ? 'Changes apply to the customer menu immediately.' : 'Add a dish or drink to the menu.'}
      footer={
        <div className="flex items-center justify-between gap-3">
          {product && (
            <Button
              variant="ghost"
              size="sm"
              loading={archive.isPending}
              onClick={() => archive.mutate()}
              leadingIcon={<Trash2 className="size-3.5" />}
            >
              Archive
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {product ? 'Save changes' : 'Add item'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="p-name" required error={errors.name} className="sm:col-span-2">
            <Input
              id="p-name"
              value={draft.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="Double Beef Burger"
              invalid={Boolean(errors.name)}
            />
          </Field>

          <Field label="Category" htmlFor="p-category" required error={errors.categoryId}>
            <Select
              id="p-category"
              value={draft.categoryId}
              onChange={(event) => update('categoryId', event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={`Price (${currency})`} htmlFor="p-price" required error={errors.basePrice}>
            <Input
              id="p-price"
              inputMode="decimal"
              value={draft.basePrice}
              onChange={(event) => update('basePrice', event.target.value)}
              placeholder="27.500"
              className="tabular"
              invalid={Boolean(errors.basePrice)}
            />
          </Field>

          <Field label="Description" htmlFor="p-description" className="sm:col-span-2">
            <Textarea
              id="p-description"
              value={draft.description}
              onChange={(event) => update('description', event.target.value)}
              placeholder="What is in it, and why it is good."
              rows={2}
            />
          </Field>

          <Field label="Status" htmlFor="p-status">
            <Select
              id="p-status"
              value={draft.status}
              onChange={(event) => update('status', event.target.value as Draft['status'])}
            >
              <option value="AVAILABLE">Available</option>
              <option value="UNAVAILABLE">Unavailable (86'd)</option>
              <option value="HIDDEN">Hidden from the menu</option>
            </Select>
          </Field>

          <Field label="Kitchen station" htmlFor="p-station">
            <Select
              id="p-station"
              value={draft.kitchenStationId}
              onChange={(event) => update('kitchenStationId', event.target.value)}
            >
              <option value="">Unassigned</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Prep time (minutes)" htmlFor="p-prep">
            <Input
              id="p-prep"
              type="number"
              min={1}
              max={240}
              value={draft.prepTimeMinutes}
              onChange={(event) => update('prepTimeMinutes', event.target.value)}
              className="tabular"
            />
          </Field>

          <Field label="Calories" htmlFor="p-calories" hint="optional">
            <Input
              id="p-calories"
              type="number"
              min={0}
              value={draft.calories}
              onChange={(event) => update('calories', event.target.value)}
              className="tabular"
            />
          </Field>

          <Field label="Allergens" htmlFor="p-allergens" description="Comma separated" className="sm:col-span-2">
            <Input
              id="p-allergens"
              value={draft.allergens}
              onChange={(event) => update('allergens', event.target.value)}
              placeholder="gluten, dairy, eggs"
            />
          </Field>

          <Field label="Tags" htmlFor="p-tags" description="Comma separated" className="sm:col-span-2">
            <Input
              id="p-tags"
              value={draft.tags}
              onChange={(event) => update('tags', event.target.value)}
              placeholder="vegetarian, spicy, signature"
            />
          </Field>

          <Field
            label="Image URL"
            htmlFor="p-image"
            description="Leave empty to use the generated artwork"
            className="sm:col-span-2"
          >
            <Input
              id="p-image"
              value={draft.imageUrl}
              onChange={(event) => update('imageUrl', event.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-6 rounded-lg border border-line bg-surface-sunken/50 p-4">
          <Switch
            id="p-popular"
            checked={draft.popular}
            onChange={(value) => update('popular', value)}
            label="Popular"
            description="Shown in the guest's “Popular right now” rail"
          />
          <Switch
            id="p-featured"
            checked={draft.featured}
            onChange={(value) => update('featured', value)}
            label="Chef's pick"
            description="Featured at the top of the menu"
          />
        </div>

        {/* ---------------------------------------------------- variants */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">Sizes / variants</h3>
              <p className="text-xs text-ink-muted">Each adds to the base price.</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Plus className="size-3.5" />}
              onClick={() =>
                update('variants', [...draft.variants, { name: '', priceDelta: '0.000', available: true }])
              }
            >
              Add
            </Button>
          </div>

          {draft.variants.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">
              No variants — the item is sold at one size.
            </p>
          ) : (
            <ul className="space-y-2">
              {draft.variants.map((variant, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Input
                    aria-label="Variant name"
                    value={variant.name}
                    onChange={(event) => {
                      const next = [...draft.variants];
                      next[index] = { ...variant, name: event.target.value };
                      update('variants', next);
                    }}
                    placeholder="Large"
                    className="flex-1"
                  />
                  <Input
                    aria-label="Price difference"
                    inputMode="decimal"
                    value={variant.priceDelta}
                    onChange={(event) => {
                      const next = [...draft.variants];
                      next[index] = { ...variant, priceDelta: event.target.value };
                      update('variants', next);
                    }}
                    className="tabular w-28"
                  />
                  <IconButton
                    label="Remove variant"
                    size="sm"
                    onClick={() => update('variants', draft.variants.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --------------------------------------------- modifier groups */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">Options</h3>
              <p className="text-xs text-ink-muted">Extras, preferences and required choices.</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Plus className="size-3.5" />}
              onClick={() =>
                update('modifierGroups', [
                  ...draft.modifierGroups,
                  {
                    name: '',
                    selectionType: 'MULTIPLE',
                    required: false,
                    minSelect: 0,
                    maxSelect: '',
                    options: [{ name: '', priceDelta: '0.000', available: true }],
                  },
                ])
              }
            >
              Add group
            </Button>
          </div>

          {draft.modifierGroups.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">
              No option groups.
            </p>
          ) : (
            <div className="space-y-3">
              {draft.modifierGroups.map((group, groupIndex) => (
                <div key={groupIndex} className="rounded-lg border border-line p-3.5">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Group name"
                      value={group.name}
                      onChange={(event) => {
                        const next = [...draft.modifierGroups];
                        next[groupIndex] = { ...group, name: event.target.value };
                        update('modifierGroups', next);
                      }}
                      placeholder="Extras"
                      className="flex-1"
                    />
                    <Select
                      aria-label="Selection type"
                      value={group.selectionType}
                      onChange={(event) => {
                        const next = [...draft.modifierGroups];
                        next[groupIndex] = {
                          ...group,
                          selectionType: event.target.value as 'SINGLE' | 'MULTIPLE',
                        };
                        update('modifierGroups', next);
                      }}
                      className="w-32"
                    >
                      <option value="SINGLE">Pick one</option>
                      <option value="MULTIPLE">Pick many</option>
                    </Select>
                    <IconButton
                      label="Remove group"
                      size="sm"
                      onClick={() =>
                        update(
                          'modifierGroups',
                          draft.modifierGroups.filter((_, i) => i !== groupIndex),
                        )
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-4">
                    <Switch
                      checked={group.required}
                      onChange={(value) => {
                        const next = [...draft.modifierGroups];
                        next[groupIndex] = { ...group, required: value, minSelect: value ? 1 : 0 };
                        update('modifierGroups', next);
                      }}
                      label="Required"
                    />
                    {group.selectionType === 'MULTIPLE' && (
                      <label className="flex items-center gap-2 text-xs text-ink-soft">
                        Max
                        <Input
                          type="number"
                          min={1}
                          value={group.maxSelect}
                          onChange={(event) => {
                            const next = [...draft.modifierGroups];
                            next[groupIndex] = { ...group, maxSelect: event.target.value };
                            update('modifierGroups', next);
                          }}
                          className="tabular h-8 w-16"
                        />
                      </label>
                    )}
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {group.options.map((option, optionIndex) => (
                      <li key={optionIndex} className="flex items-center gap-2">
                        <Input
                          aria-label="Option name"
                          value={option.name}
                          onChange={(event) => {
                            const next = [...draft.modifierGroups];
                            const options = [...group.options];
                            options[optionIndex] = { ...option, name: event.target.value };
                            next[groupIndex] = { ...group, options };
                            update('modifierGroups', next);
                          }}
                          placeholder="Extra cheese"
                          className="h-9 flex-1"
                        />
                        <Input
                          aria-label="Option price"
                          inputMode="decimal"
                          value={option.priceDelta}
                          onChange={(event) => {
                            const next = [...draft.modifierGroups];
                            const options = [...group.options];
                            options[optionIndex] = { ...option, priceDelta: event.target.value };
                            next[groupIndex] = { ...group, options };
                            update('modifierGroups', next);
                          }}
                          className="tabular h-9 w-24"
                        />
                        <IconButton
                          label="Remove option"
                          size="sm"
                          onClick={() => {
                            const next = [...draft.modifierGroups];
                            next[groupIndex] = {
                              ...group,
                              options: group.options.filter((_, i) => i !== optionIndex),
                            };
                            update('modifierGroups', next);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </li>
                    ))}
                  </ul>

                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn('mt-2')}
                    leadingIcon={<Plus className="size-3.5" />}
                    onClick={() => {
                      const next = [...draft.modifierGroups];
                      next[groupIndex] = {
                        ...group,
                        options: [...group.options, { name: '', priceDelta: '0.000', available: true }],
                      };
                      update('modifierGroups', next);
                    }}
                  >
                    Add option
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </SidePanel>
  );
}
