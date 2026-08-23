import { useState } from 'react';
import {
  Beef,
  CakeSlice,
  Coffee,
  Croissant,
  CupSoda,
  Drumstick,
  EggFried,
  Fish,
  IceCreamCone,
  Leaf,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  UtensilsCrossed,
  Wheat,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Product imagery.
 *
 * Real photography is fully supported — pass `src` and it is used. When a
 * restaurant has not uploaded a photo yet (as in the seeded demo) we draw a
 * deterministic, warm gradient plate with a dish glyph instead of showing a
 * broken frame or a grey box. The same product always gets the same artwork.
 */

const PALETTES: Array<[string, string, string]> = [
  ['#F5E6D3', '#E8CDA9', '#8A6A43'], // toasted almond
  ['#EAF0E4', '#CFE0C3', '#4E6B45'], // herb
  ['#FCE8E1', '#F5CDBE', '#9A5540'], // terracotta
  ['#E7EEF3', '#C9DCE7', '#3E6076'], // sea salt
  ['#F7EDD9', '#EEDAAE', '#8F6E2C'], // saffron
  ['#F0E9F4', '#DCCFE6', '#5F4A72'], // fig
  ['#FDEBD2', '#F7D3A0', '#9A6520'], // honey
  ['#E6EFEC', '#C6DDD5', '#3D6659'], // sage
];

const GLYPHS = [
  { match: /pizza|margherita|diavola|formaggi|tonno|vegetariana/i, Icon: Pizza },
  { match: /burger|cheeseburger/i, Icon: Sandwich },
  { match: /pasta|spaghetti|penne|linguine|alfredo|bolognese/i, Icon: Wheat },
  { match: /salad|caesar|burrata|quinoa/i, Icon: Salad },
  { match: /coffee|espresso|cappuccino|latte|affogato/i, Icon: Coffee },
  { match: /juice|cola|lemonade|water|mojito|soda|tea/i, Icon: CupSoda },
  { match: /ice cream|gelato|sundae/i, Icon: IceCreamCone },
  { match: /cake|tiramisu|cheesecake|brûlée|brulee|baklava|dessert|pancake/i, Icon: CakeSlice },
  { match: /egg|shakshuka|breakfast|avocado|toast/i, Icon: EggFried },
  { match: /chicken|drumstick|wings/i, Icon: Drumstick },
  { match: /fish|sea bass|prawn|seafood|salmon/i, Icon: Fish },
  { match: /beef|steak|merguez|grill/i, Icon: Beef },
  { match: /soup|shorba/i, Icon: Soup },
  { match: /croissant|pastry|bakery/i, Icon: Croissant },
  { match: /yoghurt|yogurt|fruit|vegan|veg/i, Icon: Leaf },
];

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function glyphFor(name: string) {
  return GLYPHS.find((entry) => entry.match.test(name))?.Icon ?? UtensilsCrossed;
}

export function FoodImage({
  src,
  name,
  className,
  rounded = 'rounded-md',
  eager,
}: {
  src?: string | null;
  name: string;
  className?: string;
  rounded?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  const seed = hash(name);
  const [from, to, ink] = PALETTES[seed % PALETTES.length];
  const Glyph = glyphFor(name);
  const angle = 120 + (seed % 5) * 25;

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
        className={cn('size-full object-cover', rounded, className)}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={name}
      className={cn('relative size-full overflow-hidden', rounded, className)}
      style={{ background: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }}
    >
      <span
        aria-hidden
        className="absolute -right-[15%] -top-[25%] size-[70%] rounded-full opacity-40 blur-2xl"
        style={{ background: from }}
      />
      <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
        <Glyph
          className="size-[38%] max-h-16 min-h-6 opacity-30"
          strokeWidth={1.25}
          style={{ color: ink }}
        />
      </span>
    </div>
  );
}

/** Small round avatar used in dense lists (order lines, kitchen tickets). */
export function FoodAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <div className={cn('size-10 shrink-0 overflow-hidden rounded-md', className)}>
      <FoodImage name={name} src={src} rounded="rounded-md" />
    </div>
  );
}
