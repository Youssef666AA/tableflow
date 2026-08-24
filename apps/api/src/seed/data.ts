/**
 * Menu, staff and inventory definitions for the BIG BEN CAFÉ demo restaurant.
 * Prices are in millimes (TND minor units): 12.500 TND -> 12500.
 */

export interface SeedVariant {
  name: string;
  priceDelta: number;
  available?: boolean;
}

export interface SeedModifierOption {
  name: string;
  priceDelta: number;
  available?: boolean;
}

export interface SeedModifierGroup {
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  required?: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  options: SeedModifierOption[];
}

export interface SeedProduct {
  name: string;
  description: string;
  basePrice: number;
  category: string;
  station: string;
  prepTimeMinutes: number;
  popular?: boolean;
  featured?: boolean;
  status?: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN';
  allergens?: string[];
  tags?: string[];
  calories?: number;
  variants?: SeedVariant[];
  modifierGroups?: SeedModifierGroup[];
  recipe?: Array<{ item: string; quantity: number; unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'portion' }>;
}

export const CATEGORIES = [
  { name: 'Breakfast', description: 'Served until 11:30, every day of the week.' },
  { name: 'Pizza', description: 'Stone-baked, 30 cm, hand-stretched dough.' },
  { name: 'Burgers', description: 'Ground fresh daily, served with skin-on fries.' },
  { name: 'Pasta', description: 'Fresh egg pasta made in-house each morning.' },
  { name: 'Salads', description: 'Bright, generous and properly dressed.' },
  { name: 'Drinks', description: 'Coffee, juices, sodas and mocktails.' },
  { name: 'Desserts', description: 'Sweet things worth saving room for.' },
];

export const STATIONS = [
  { name: 'Kitchen', color: '#8b5cf6' },
  { name: 'Grill', color: '#ef4444' },
  { name: 'Pizza', color: '#f59e0b' },
  { name: 'Drinks', color: '#0ea5e9' },
  { name: 'Desserts', color: '#ec4899' },
];

const PIZZA_EXTRAS: SeedModifierGroup = {
  name: 'Extras',
  selectionType: 'MULTIPLE',
  maxSelect: 5,
  options: [
    { name: 'Extra mozzarella', priceDelta: 2500 },
    { name: 'Extra sauce', priceDelta: 1000 },
    { name: 'Mushrooms', priceDelta: 2000 },
    { name: 'Black olives', priceDelta: 1500 },
    { name: 'Spicy merguez', priceDelta: 3500 },
  ],
};

const BURGER_EXTRAS: SeedModifierGroup = {
  name: 'Extras',
  selectionType: 'MULTIPLE',
  maxSelect: 5,
  options: [
    { name: 'Extra cheese slice', priceDelta: 2000 },
    { name: 'Fried egg', priceDelta: 2000 },
    { name: 'Turkey bacon', priceDelta: 3000 },
    { name: 'Caramelised onions', priceDelta: 1500 },
    { name: 'Extra patty', priceDelta: 7000 },
  ],
};

const PREFERENCES: SeedModifierGroup = {
  name: 'Preferences',
  selectionType: 'MULTIPLE',
  maxSelect: 4,
  options: [
    { name: 'No onions', priceDelta: 0 },
    { name: 'No tomato', priceDelta: 0 },
    { name: 'Extra spicy', priceDelta: 0 },
    { name: 'Sauce on the side', priceDelta: 0 },
  ],
};

const COOKING: SeedModifierGroup = {
  name: 'Cooking',
  selectionType: 'SINGLE',
  required: true,
  minSelect: 1,
  maxSelect: 1,
  options: [
    { name: 'Medium', priceDelta: 0 },
    { name: 'Medium well', priceDelta: 0 },
    { name: 'Well done', priceDelta: 0 },
  ],
};

const MILK: SeedModifierGroup = {
  name: 'Milk',
  selectionType: 'SINGLE',
  maxSelect: 1,
  options: [
    { name: 'Whole milk', priceDelta: 0 },
    { name: 'Skimmed milk', priceDelta: 0 },
    { name: 'Oat milk', priceDelta: 1500 },
    { name: 'Almond milk', priceDelta: 1500 },
  ],
};

const ICE: SeedModifierGroup = {
  name: 'Serve',
  selectionType: 'SINGLE',
  maxSelect: 1,
  options: [
    { name: 'With ice', priceDelta: 0 },
    { name: 'No ice', priceDelta: 0 },
  ],
};

export const PRODUCTS: SeedProduct[] = [
  /* ---------------------------------------------------------- breakfast */
  {
    name: 'Big Ben Breakfast',
    description: 'Two eggs your way, turkey bacon, grilled tomato, sautéed mushrooms and sourdough toast.',
    basePrice: 18500,
    category: 'Breakfast',
    station: 'Kitchen',
    prepTimeMinutes: 14,
    popular: true,
    featured: true,
    allergens: ['eggs', 'gluten'],
    tags: ['breakfast', 'hearty'],
    calories: 780,
    modifierGroups: [
      {
        name: 'Eggs',
        selectionType: 'SINGLE',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'Fried', priceDelta: 0 },
          { name: 'Scrambled', priceDelta: 0 },
          { name: 'Poached', priceDelta: 1000 },
        ],
      },
      PREFERENCES,
    ],
    recipe: [
      { item: 'Eggs', quantity: 2, unit: 'pcs' },
      { item: 'Turkey bacon', quantity: 60, unit: 'g' },
      { item: 'Tomatoes', quantity: 80, unit: 'g' },
      { item: 'Mushrooms', quantity: 60, unit: 'g' },
      { item: 'Sourdough bread', quantity: 2, unit: 'pcs' },
    ],
  },
  {
    name: 'Avocado Toast',
    description: 'Smashed avocado, chilli flakes, lemon and toasted sourdough. Add a poached egg.',
    basePrice: 14500,
    category: 'Breakfast',
    station: 'Kitchen',
    prepTimeMinutes: 8,
    popular: true,
    allergens: ['gluten'],
    tags: ['vegetarian', 'light'],
    calories: 420,
    modifierGroups: [
      {
        name: 'Add on',
        selectionType: 'MULTIPLE',
        maxSelect: 3,
        options: [
          { name: 'Poached egg', priceDelta: 2500 },
          { name: 'Feta', priceDelta: 2500 },
          { name: 'Smoked salmon', priceDelta: 6000 },
        ],
      },
    ],
    recipe: [
      { item: 'Avocado', quantity: 1, unit: 'pcs' },
      { item: 'Sourdough bread', quantity: 2, unit: 'pcs' },
    ],
  },
  {
    name: 'Shakshuka',
    description: 'Eggs baked in a spiced tomato and pepper sauce, finished with parsley and crusty bread.',
    basePrice: 16000,
    category: 'Breakfast',
    station: 'Kitchen',
    prepTimeMinutes: 16,
    allergens: ['eggs', 'gluten'],
    tags: ['vegetarian', 'spicy'],
    calories: 520,
    modifierGroups: [PREFERENCES],
    recipe: [
      { item: 'Eggs', quantity: 2, unit: 'pcs' },
      { item: 'Tomatoes', quantity: 200, unit: 'g' },
      { item: 'Onions', quantity: 60, unit: 'g' },
    ],
  },
  {
    name: 'Pancake Stack',
    description: 'Three buttermilk pancakes, maple syrup and seasonal fruit.',
    basePrice: 13500,
    category: 'Breakfast',
    station: 'Desserts',
    prepTimeMinutes: 12,
    allergens: ['gluten', 'eggs', 'dairy'],
    tags: ['sweet'],
    calories: 610,
  },
  {
    name: 'Greek Yoghurt Bowl',
    description: 'Thick yoghurt, honey, toasted almonds and berries.',
    basePrice: 11000,
    category: 'Breakfast',
    station: 'Desserts',
    prepTimeMinutes: 5,
    allergens: ['dairy', 'nuts'],
    tags: ['light', 'vegetarian'],
    calories: 320,
  },

  /* -------------------------------------------------------------- pizza */
  {
    name: 'Margherita',
    description: 'San Marzano tomato, fior di latte mozzarella, fresh basil, extra virgin olive oil.',
    basePrice: 19000,
    category: 'Pizza',
    station: 'Pizza',
    prepTimeMinutes: 15,
    popular: true,
    featured: true,
    allergens: ['gluten', 'dairy'],
    tags: ['vegetarian', 'classic'],
    calories: 850,
    variants: [
      { name: '30 cm', priceDelta: 0 },
      { name: '40 cm', priceDelta: 8000 },
    ],
    modifierGroups: [PIZZA_EXTRAS, PREFERENCES],
    recipe: [
      { item: 'Pizza dough', quantity: 1, unit: 'pcs' },
      { item: 'Mozzarella', quantity: 150, unit: 'g' },
      { item: 'Tomatoes', quantity: 120, unit: 'g' },
    ],
  },
  {
    name: 'Quattro Formaggi',
    description: 'Mozzarella, gorgonzola, parmesan and scamorza with a drizzle of honey.',
    basePrice: 24000,
    category: 'Pizza',
    station: 'Pizza',
    prepTimeMinutes: 15,
    allergens: ['gluten', 'dairy'],
    tags: ['vegetarian', 'rich'],
    calories: 1080,
    variants: [
      { name: '30 cm', priceDelta: 0 },
      { name: '40 cm', priceDelta: 9000 },
    ],
    modifierGroups: [PIZZA_EXTRAS],
    recipe: [
      { item: 'Pizza dough', quantity: 1, unit: 'pcs' },
      { item: 'Mozzarella', quantity: 200, unit: 'g' },
    ],
  },
  {
    name: 'Merguez & Peppers',
    description: 'Spicy merguez sausage, roasted peppers, red onion and harissa oil.',
    basePrice: 26500,
    category: 'Pizza',
    station: 'Pizza',
    prepTimeMinutes: 17,
    popular: true,
    allergens: ['gluten', 'dairy'],
    tags: ['spicy', 'tunisian'],
    calories: 1120,
    variants: [
      { name: '30 cm', priceDelta: 0 },
      { name: '40 cm', priceDelta: 9000 },
    ],
    modifierGroups: [PIZZA_EXTRAS, PREFERENCES],
    recipe: [
      { item: 'Pizza dough', quantity: 1, unit: 'pcs' },
      { item: 'Mozzarella', quantity: 140, unit: 'g' },
      { item: 'Merguez sausage', quantity: 120, unit: 'g' },
      { item: 'Onions', quantity: 50, unit: 'g' },
    ],
  },
  {
    name: 'Tonno e Cipolla',
    description: 'Tuna, red onion, capers and oregano on a light tomato base.',
    basePrice: 23500,
    category: 'Pizza',
    station: 'Pizza',
    prepTimeMinutes: 15,
    allergens: ['gluten', 'dairy', 'fish'],
    tags: ['seafood'],
    calories: 940,
    variants: [
      { name: '30 cm', priceDelta: 0 },
      { name: '40 cm', priceDelta: 9000 },
    ],
    modifierGroups: [PIZZA_EXTRAS],
  },
  {
    name: 'Vegetariana',
    description: 'Courgette, aubergine, peppers, cherry tomato and rocket.',
    basePrice: 21500,
    category: 'Pizza',
    station: 'Pizza',
    prepTimeMinutes: 15,
    allergens: ['gluten', 'dairy'],
    tags: ['vegetarian'],
    calories: 780,
    variants: [
      { name: '30 cm', priceDelta: 0 },
      { name: '40 cm', priceDelta: 8500 },
    ],
    modifierGroups: [PIZZA_EXTRAS, PREFERENCES],
  },
  {
    name: 'Diavola',
    description: 'Spicy salami, mozzarella, chilli and tomato.',
    basePrice: 24500,
    category: 'Pizza',
    station: 'Pizza',
    prepTimeMinutes: 15,
    allergens: ['gluten', 'dairy'],
    tags: ['spicy'],
    calories: 1010,
    variants: [
      { name: '30 cm', priceDelta: 0 },
      { name: '40 cm', priceDelta: 9000 },
    ],
    modifierGroups: [PIZZA_EXTRAS],
  },

  /* ------------------------------------------------------------ burgers */
  {
    name: 'Double Beef Burger',
    description: 'Two 75 g patties, double cheddar, pickles, lettuce, tomato and house burger sauce.',
    basePrice: 27500,
    category: 'Burgers',
    station: 'Grill',
    prepTimeMinutes: 12,
    popular: true,
    featured: true,
    allergens: ['gluten', 'dairy', 'eggs'],
    tags: ['signature'],
    calories: 1180,
    modifierGroups: [COOKING, BURGER_EXTRAS, PREFERENCES],
    recipe: [
      { item: 'Burger bun', quantity: 1, unit: 'pcs' },
      { item: 'Beef mince', quantity: 150, unit: 'g' },
      { item: 'Cheddar slices', quantity: 2, unit: 'pcs' },
      { item: 'Tomatoes', quantity: 30, unit: 'g' },
      { item: 'Burger sauce', quantity: 20, unit: 'ml' },
      { item: 'Potatoes', quantity: 180, unit: 'g' },
    ],
  },
  {
    name: 'Classic Cheeseburger',
    description: 'Single patty, cheddar, lettuce, tomato, onion and house sauce.',
    basePrice: 19500,
    category: 'Burgers',
    station: 'Grill',
    prepTimeMinutes: 11,
    popular: true,
    allergens: ['gluten', 'dairy', 'eggs'],
    calories: 820,
    modifierGroups: [COOKING, BURGER_EXTRAS, PREFERENCES],
    recipe: [
      { item: 'Burger bun', quantity: 1, unit: 'pcs' },
      { item: 'Beef mince', quantity: 120, unit: 'g' },
      { item: 'Cheddar slices', quantity: 1, unit: 'pcs' },
      { item: 'Potatoes', quantity: 180, unit: 'g' },
    ],
  },
  {
    name: 'Crispy Chicken Burger',
    description: 'Buttermilk-fried chicken thigh, slaw, pickles and chipotle mayo.',
    basePrice: 22000,
    category: 'Burgers',
    station: 'Grill',
    prepTimeMinutes: 13,
    allergens: ['gluten', 'eggs', 'dairy'],
    calories: 910,
    modifierGroups: [BURGER_EXTRAS, PREFERENCES],
    recipe: [
      { item: 'Burger bun', quantity: 1, unit: 'pcs' },
      { item: 'Chicken breast', quantity: 160, unit: 'g' },
      { item: 'Potatoes', quantity: 180, unit: 'g' },
    ],
  },
  {
    name: 'Mushroom Swiss Burger',
    description: 'Beef patty, sautéed mushrooms, Swiss cheese and garlic aioli.',
    basePrice: 24000,
    category: 'Burgers',
    station: 'Grill',
    prepTimeMinutes: 13,
    allergens: ['gluten', 'dairy', 'eggs'],
    calories: 950,
    modifierGroups: [COOKING, BURGER_EXTRAS],
    recipe: [
      { item: 'Burger bun', quantity: 1, unit: 'pcs' },
      { item: 'Beef mince', quantity: 130, unit: 'g' },
      { item: 'Mushrooms', quantity: 70, unit: 'g' },
      { item: 'Potatoes', quantity: 180, unit: 'g' },
    ],
  },
  {
    name: 'Veggie Halloumi Burger',
    description: 'Grilled halloumi, roasted pepper, rocket and sun-dried tomato pesto.',
    basePrice: 20500,
    category: 'Burgers',
    station: 'Grill',
    prepTimeMinutes: 11,
    allergens: ['gluten', 'dairy'],
    tags: ['vegetarian'],
    calories: 720,
    modifierGroups: [PREFERENCES],
  },

  /* -------------------------------------------------------------- pasta */
  {
    name: 'Chicken Alfredo',
    description: 'Fettuccine, grilled chicken, parmesan cream and cracked pepper.',
    basePrice: 24500,
    category: 'Pasta',
    station: 'Kitchen',
    prepTimeMinutes: 16,
    popular: true,
    allergens: ['gluten', 'dairy'],
    calories: 980,
    modifierGroups: [PREFERENCES],
    recipe: [
      { item: 'Fresh pasta', quantity: 180, unit: 'g' },
      { item: 'Chicken breast', quantity: 140, unit: 'g' },
      { item: 'Cream', quantity: 120, unit: 'ml' },
      { item: 'Parmesan', quantity: 30, unit: 'g' },
    ],
  },
  {
    name: 'Spaghetti Bolognese',
    description: 'Slow-cooked beef ragù, tomato, herbs and parmesan.',
    basePrice: 22500,
    category: 'Pasta',
    station: 'Kitchen',
    prepTimeMinutes: 15,
    allergens: ['gluten', 'dairy'],
    calories: 890,
    modifierGroups: [PREFERENCES],
    recipe: [
      { item: 'Fresh pasta', quantity: 180, unit: 'g' },
      { item: 'Beef mince', quantity: 120, unit: 'g' },
      { item: 'Tomatoes', quantity: 150, unit: 'g' },
    ],
  },
  {
    name: 'Penne Arrabbiata',
    description: 'Garlic, chilli and tomato — simple and properly spicy.',
    basePrice: 18500,
    category: 'Pasta',
    station: 'Kitchen',
    prepTimeMinutes: 13,
    allergens: ['gluten'],
    tags: ['vegetarian', 'spicy'],
    calories: 640,
    modifierGroups: [PREFERENCES],
  },
  {
    name: 'Seafood Linguine',
    description: 'Prawns, calamari and mussels in a white wine and garlic sauce.',
    basePrice: 32000,
    category: 'Pasta',
    station: 'Kitchen',
    prepTimeMinutes: 18,
    featured: true,
    allergens: ['gluten', 'shellfish'],
    tags: ['seafood'],
    calories: 760,
  },
  {
    name: 'Truffle Mushroom Pasta',
    description: 'Wild mushrooms, truffle oil, parmesan and parsley.',
    basePrice: 27500,
    category: 'Pasta',
    station: 'Kitchen',
    prepTimeMinutes: 16,
    allergens: ['gluten', 'dairy'],
    tags: ['vegetarian'],
    calories: 810,
    recipe: [
      { item: 'Fresh pasta', quantity: 180, unit: 'g' },
      { item: 'Mushrooms', quantity: 140, unit: 'g' },
      { item: 'Cream', quantity: 90, unit: 'ml' },
    ],
  },

  /* ------------------------------------------------------------- salads */
  {
    name: 'Caesar Salad',
    description: 'Baby gem, parmesan, sourdough croutons and classic Caesar dressing.',
    basePrice: 17500,
    category: 'Salads',
    station: 'Kitchen',
    prepTimeMinutes: 8,
    popular: true,
    allergens: ['gluten', 'dairy', 'eggs', 'fish'],
    calories: 430,
    modifierGroups: [
      {
        name: 'Add protein',
        selectionType: 'SINGLE',
        maxSelect: 1,
        options: [
          { name: 'No protein', priceDelta: 0 },
          { name: 'Grilled chicken', priceDelta: 6000 },
          { name: 'Grilled prawns', priceDelta: 9000 },
        ],
      },
      PREFERENCES,
    ],
    recipe: [
      { item: 'Lettuce', quantity: 150, unit: 'g' },
      { item: 'Parmesan', quantity: 25, unit: 'g' },
    ],
  },
  {
    name: 'Tunisian Salad',
    description: 'Finely diced tomato, cucumber, pepper, onion, tuna, egg and olives.',
    basePrice: 15000,
    category: 'Salads',
    station: 'Kitchen',
    prepTimeMinutes: 7,
    popular: true,
    allergens: ['fish', 'eggs'],
    tags: ['tunisian', 'fresh'],
    calories: 380,
    recipe: [
      { item: 'Tomatoes', quantity: 150, unit: 'g' },
      { item: 'Onions', quantity: 40, unit: 'g' },
      { item: 'Eggs', quantity: 1, unit: 'pcs' },
    ],
  },
  {
    name: 'Burrata & Tomato',
    description: 'Whole burrata, heritage tomatoes, basil oil and sea salt.',
    basePrice: 23000,
    category: 'Salads',
    station: 'Kitchen',
    prepTimeMinutes: 6,
    featured: true,
    allergens: ['dairy'],
    tags: ['vegetarian'],
    calories: 490,
  },
  {
    name: 'Quinoa & Roasted Veg',
    description: 'Quinoa, roasted root vegetables, pomegranate and tahini dressing.',
    basePrice: 19000,
    category: 'Salads',
    station: 'Kitchen',
    prepTimeMinutes: 9,
    tags: ['vegan', 'healthy'],
    calories: 450,
  },

  /* ------------------------------------------------------------- drinks */
  {
    name: 'Espresso',
    description: 'Single origin, roasted locally, pulled short.',
    basePrice: 3500,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 3,
    popular: true,
    calories: 5,
    variants: [
      { name: 'Single', priceDelta: 0 },
      { name: 'Double', priceDelta: 1500 },
    ],
    recipe: [{ item: 'Coffee beans', quantity: 9, unit: 'g' }],
  },
  {
    name: 'Cappuccino',
    description: 'Espresso, steamed milk and a proper cap of microfoam.',
    basePrice: 6000,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 4,
    popular: true,
    allergens: ['dairy'],
    calories: 120,
    variants: [
      { name: 'Regular', priceDelta: 0 },
      { name: 'Large', priceDelta: 2000 },
    ],
    modifierGroups: [MILK],
    recipe: [
      { item: 'Coffee beans', quantity: 18, unit: 'g' },
      { item: 'Milk', quantity: 150, unit: 'ml' },
    ],
  },
  {
    name: 'Café Latte',
    description: 'Long, milky and smooth.',
    basePrice: 6500,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 4,
    allergens: ['dairy'],
    calories: 160,
    variants: [
      { name: 'Regular', priceDelta: 0 },
      { name: 'Large', priceDelta: 2000 },
    ],
    modifierGroups: [MILK],
    recipe: [
      { item: 'Coffee beans', quantity: 18, unit: 'g' },
      { item: 'Milk', quantity: 220, unit: 'ml' },
    ],
  },
  {
    name: 'Mint Tea',
    description: 'Green tea, fresh mint and pine nuts — the Tunisian way.',
    basePrice: 4500,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 5,
    tags: ['tunisian'],
    allergens: ['nuts'],
    calories: 60,
  },
  {
    name: 'Coca-Cola',
    description: 'Chilled 33 cl can.',
    basePrice: 4000,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 2,
    popular: true,
    calories: 139,
    modifierGroups: [ICE],
    recipe: [{ item: 'Soft drink cans', quantity: 1, unit: 'pcs' }],
  },
  {
    name: 'Sparkling Water',
    description: '50 cl bottle, served chilled with lemon.',
    basePrice: 3500,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 2,
    calories: 0,
    modifierGroups: [ICE],
  },
  {
    name: 'Fresh Orange Juice',
    description: 'Pressed to order. Nothing added.',
    basePrice: 8000,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 5,
    popular: true,
    featured: true,
    tags: ['fresh'],
    calories: 110,
    variants: [
      { name: '25 cl', priceDelta: 0 },
      { name: '40 cl', priceDelta: 3000 },
    ],
    modifierGroups: [ICE],
    recipe: [{ item: 'Oranges', quantity: 400, unit: 'g' }],
  },
  {
    name: 'Lemonade & Mint',
    description: 'Pressed lemon, mint leaves and a little cane sugar.',
    basePrice: 7500,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 5,
    tags: ['fresh'],
    calories: 130,
    modifierGroups: [ICE],
  },
  {
    name: 'Iced Latte',
    description: 'Double espresso poured over ice and cold milk.',
    basePrice: 7500,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 4,
    allergens: ['dairy'],
    calories: 140,
    modifierGroups: [MILK],
    recipe: [
      { item: 'Coffee beans', quantity: 18, unit: 'g' },
      { item: 'Milk', quantity: 180, unit: 'ml' },
    ],
  },
  {
    name: 'Mojito Mocktail',
    description: 'Lime, mint, cane sugar and soda. Alcohol-free.',
    basePrice: 11000,
    category: 'Drinks',
    station: 'Drinks',
    prepTimeMinutes: 6,
    tags: ['mocktail'],
    calories: 180,
  },

  /* ----------------------------------------------------------- desserts */
  {
    name: 'Tiramisu',
    description: 'Mascarpone, espresso-soaked savoiardi and cocoa. Made this morning.',
    basePrice: 12500,
    category: 'Desserts',
    station: 'Desserts',
    prepTimeMinutes: 5,
    popular: true,
    featured: true,
    allergens: ['dairy', 'eggs', 'gluten'],
    calories: 420,
    recipe: [
      { item: 'Mascarpone', quantity: 80, unit: 'g' },
      { item: 'Coffee beans', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Molten Chocolate Cake',
    description: 'Warm dark chocolate fondant with vanilla ice cream.',
    basePrice: 14000,
    category: 'Desserts',
    station: 'Desserts',
    prepTimeMinutes: 12,
    popular: true,
    allergens: ['dairy', 'eggs', 'gluten'],
    calories: 560,
  },
  {
    name: 'Crème Brûlée',
    description: 'Vanilla custard under a hard caramel top.',
    basePrice: 12000,
    category: 'Desserts',
    station: 'Desserts',
    prepTimeMinutes: 6,
    allergens: ['dairy', 'eggs'],
    calories: 390,
  },
  {
    name: 'Baklava Selection',
    description: 'Four pieces, pistachio and almond, with honey syrup.',
    basePrice: 13500,
    category: 'Desserts',
    station: 'Desserts',
    prepTimeMinutes: 4,
    allergens: ['nuts', 'gluten'],
    tags: ['tunisian'],
    calories: 480,
  },
  {
    name: 'Lemon Cheesecake',
    description: 'Baked cheesecake, lemon curd and a biscuit base.',
    basePrice: 13000,
    category: 'Desserts',
    station: 'Desserts',
    prepTimeMinutes: 5,
    allergens: ['dairy', 'eggs', 'gluten'],
    calories: 450,
  },
  {
    name: 'Ice Cream Trio',
    description: 'Three scoops — vanilla, pistachio and dark chocolate.',
    basePrice: 10500,
    category: 'Desserts',
    station: 'Desserts',
    prepTimeMinutes: 3,
    allergens: ['dairy', 'nuts'],
    calories: 380,
    modifierGroups: [
      {
        name: 'Toppings',
        selectionType: 'MULTIPLE',
        maxSelect: 3,
        options: [
          { name: 'Chocolate sauce', priceDelta: 1000 },
          { name: 'Toasted almonds', priceDelta: 1500 },
          { name: 'Whipped cream', priceDelta: 1000 },
        ],
      },
    ],
  },
  {
    name: 'Seasonal Fruit Plate',
    description: 'Whatever the market had this morning, cut to order.',
    basePrice: 11500,
    category: 'Desserts',
    station: 'Desserts',
    prepTimeMinutes: 6,
    tags: ['vegan', 'light'],
    calories: 210,
  },
  {
    name: 'Affogato',
    description: 'Vanilla ice cream drowned in a shot of hot espresso.',
    basePrice: 9500,
    category: 'Desserts',
    station: 'Desserts',
    prepTimeMinutes: 3,
    allergens: ['dairy'],
    calories: 240,
    recipe: [{ item: 'Coffee beans', quantity: 9, unit: 'g' }],
  },

  /* an intentionally 86'd item so the "unavailable" state is visible in the demo */
  {
    name: 'Grilled Sea Bass',
    description: 'Whole sea bass, charred lemon, olive oil and herbs.',
    basePrice: 38000,
    category: 'Salads',
    station: 'Grill',
    prepTimeMinutes: 22,
    status: 'UNAVAILABLE',
    allergens: ['fish'],
    tags: ['seafood'],
    calories: 520,
  },
];

export interface SeedInventoryItem {
  name: string;
  unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'portion';
  quantity: number;
  minimumQuantity: number;
  /** Cost per single base unit, in millimes. */
  costPerUnit: number;
  category: string;
  supplier: string;
}

export const SUPPLIERS = [
  { name: 'Sousse Fresh Market', contactName: 'Karim Ben Aïssa', phone: '+216 73 200 110' },
  { name: 'Atlas Meat Co.', contactName: 'Sonia Trabelsi', phone: '+216 71 884 020' },
  { name: 'Medina Dairy', contactName: 'Hichem Gharbi', phone: '+216 73 442 900' },
  { name: 'Café Roasters Tunis', contactName: 'Leïla Mansouri', phone: '+216 71 330 448' },
];

export const INVENTORY: SeedInventoryItem[] = [
  { name: 'Beef mince', unit: 'kg', quantity: 6.4, minimumQuantity: 10, costPerUnit: 32, category: 'Meat', supplier: 'Atlas Meat Co.' },
  { name: 'Chicken breast', unit: 'kg', quantity: 14.2, minimumQuantity: 8, costPerUnit: 18, category: 'Meat', supplier: 'Atlas Meat Co.' },
  { name: 'Merguez sausage', unit: 'kg', quantity: 4.1, minimumQuantity: 5, costPerUnit: 26, category: 'Meat', supplier: 'Atlas Meat Co.' },
  { name: 'Turkey bacon', unit: 'kg', quantity: 3.6, minimumQuantity: 3, costPerUnit: 24, category: 'Meat', supplier: 'Atlas Meat Co.' },
  { name: 'Mozzarella', unit: 'kg', quantity: 9.8, minimumQuantity: 6, costPerUnit: 21, category: 'Dairy', supplier: 'Medina Dairy' },
  { name: 'Cheddar slices', unit: 'pcs', quantity: 240, minimumQuantity: 120, costPerUnit: 380, category: 'Dairy', supplier: 'Medina Dairy' },
  { name: 'Parmesan', unit: 'kg', quantity: 2.4, minimumQuantity: 2, costPerUnit: 68, category: 'Dairy', supplier: 'Medina Dairy' },
  { name: 'Mascarpone', unit: 'kg', quantity: 3.2, minimumQuantity: 2, costPerUnit: 34, category: 'Dairy', supplier: 'Medina Dairy' },
  { name: 'Milk', unit: 'l', quantity: 48, minimumQuantity: 30, costPerUnit: 2, category: 'Dairy', supplier: 'Medina Dairy' },
  { name: 'Cream', unit: 'l', quantity: 11, minimumQuantity: 8, costPerUnit: 6, category: 'Dairy', supplier: 'Medina Dairy' },
  { name: 'Eggs', unit: 'pcs', quantity: 360, minimumQuantity: 180, costPerUnit: 420, category: 'Dairy', supplier: 'Sousse Fresh Market' },
  { name: 'Tomatoes', unit: 'kg', quantity: 22.5, minimumQuantity: 12, costPerUnit: 4, category: 'Produce', supplier: 'Sousse Fresh Market' },
  { name: 'Onions', unit: 'kg', quantity: 18.0, minimumQuantity: 10, costPerUnit: 2, category: 'Produce', supplier: 'Sousse Fresh Market' },
  { name: 'Lettuce', unit: 'kg', quantity: 5.5, minimumQuantity: 6, costPerUnit: 5, category: 'Produce', supplier: 'Sousse Fresh Market' },
  { name: 'Mushrooms', unit: 'kg', quantity: 4.8, minimumQuantity: 4, costPerUnit: 9, category: 'Produce', supplier: 'Sousse Fresh Market' },
  { name: 'Avocado', unit: 'pcs', quantity: 42, minimumQuantity: 30, costPerUnit: 2200, category: 'Produce', supplier: 'Sousse Fresh Market' },
  { name: 'Oranges', unit: 'kg', quantity: 34.0, minimumQuantity: 20, costPerUnit: 3, category: 'Produce', supplier: 'Sousse Fresh Market' },
  { name: 'Potatoes', unit: 'kg', quantity: 41.0, minimumQuantity: 25, costPerUnit: 2, category: 'Produce', supplier: 'Sousse Fresh Market' },
  { name: 'Pizza dough', unit: 'pcs', quantity: 86, minimumQuantity: 60, costPerUnit: 900, category: 'Bakery', supplier: 'Sousse Fresh Market' },
  { name: 'Burger bun', unit: 'pcs', quantity: 128, minimumQuantity: 80, costPerUnit: 650, category: 'Bakery', supplier: 'Sousse Fresh Market' },
  { name: 'Sourdough bread', unit: 'pcs', quantity: 64, minimumQuantity: 40, costPerUnit: 700, category: 'Bakery', supplier: 'Sousse Fresh Market' },
  { name: 'Fresh pasta', unit: 'kg', quantity: 12.6, minimumQuantity: 8, costPerUnit: 11, category: 'Dry goods', supplier: 'Sousse Fresh Market' },
  { name: 'Coffee beans', unit: 'kg', quantity: 7.4, minimumQuantity: 5, costPerUnit: 46, category: 'Beverage', supplier: 'Café Roasters Tunis' },
  { name: 'Soft drink cans', unit: 'pcs', quantity: 168, minimumQuantity: 96, costPerUnit: 1400, category: 'Beverage', supplier: 'Sousse Fresh Market' },
  { name: 'Burger sauce', unit: 'l', quantity: 6.5, minimumQuantity: 4, costPerUnit: 9, category: 'Condiments', supplier: 'Sousse Fresh Market' },
];

export interface SeedEmployee {
  email: string;
  fullName: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'WAITER' | 'KITCHEN' | 'CASHIER' | 'INVENTORY';
  position: string;
  /** Empty means every branch. */
  branchSlugs: string[];
}

/**
 * The six headline demo accounts cover every branch on purpose. Whichever table
 * a visitor scans, the staff screens must light up — scoping them to one branch
 * turned "I ordered and nothing appeared" into the most common false bug report.
 * The two accounts below them stay single-branch so per-branch scoping is still
 * demonstrable (and testable) on a real login.
 */
const ALL_BRANCHES = ['sousse', 'monastir', 'tunis'];

export const EMPLOYEES: SeedEmployee[] = [
  { email: 'owner@tableflow.local', fullName: 'Amira Ben Salah', role: 'OWNER', position: 'Owner', branchSlugs: [] },
  { email: 'manager@tableflow.local', fullName: 'Youssef Khemiri', role: 'MANAGER', position: 'General manager', branchSlugs: ALL_BRANCHES },
  { email: 'waiter@tableflow.local', fullName: 'Nadia Jelassi', role: 'WAITER', position: 'Head waiter', branchSlugs: ALL_BRANCHES },
  { email: 'kitchen@tableflow.local', fullName: 'Mehdi Ayari', role: 'KITCHEN', position: 'Head chef', branchSlugs: ALL_BRANCHES },
  { email: 'cashier@tableflow.local', fullName: 'Ines Belhadj', role: 'CASHIER', position: 'Cashier', branchSlugs: ALL_BRANCHES },
  { email: 'inventory@tableflow.local', fullName: 'Walid Chaabane', role: 'INVENTORY', position: 'Stock controller', branchSlugs: ALL_BRANCHES },
  { email: 'admin@tableflow.local', fullName: 'Sami Fourati', role: 'ADMIN', position: 'Operations director', branchSlugs: [] },
  { email: 'manager.monastir@tableflow.local', fullName: 'Rania Hamdi', role: 'MANAGER', position: 'Branch manager', branchSlugs: ['monastir'] },
  { email: 'waiter.tunis@tableflow.local', fullName: 'Oussama Dridi', role: 'WAITER', position: 'Waiter', branchSlugs: ['tunis'] },
];

/** Round-the-clock, so the demo works whatever time you open it. */
const ALWAYS_OPEN = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  opensAt: '00:00',
  closesAt: '23:59',
  closed: false,
}));

/** Realistic service hours — the closed-restaurant path is enforced for these. */
const STANDARD_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  opensAt: dayOfWeek === 0 ? '09:00' : '07:30',
  closesAt: '23:30',
  closed: false,
}));

export const BRANCHES = [
  {
    name: 'Sousse — Corniche',
    slug: 'sousse',
    address: 'Boulevard de la Corniche, Sousse 4051, Tunisia',
    phone: '+216 73 227 400',
    latitude: 35.8419,
    longitude: 10.6386,
    serviceRadiusMeters: 150,
    tableCount: 30,
    kitchenSlaMinutes: 15,
    openingHours: ALWAYS_OPEN,
  },
  {
    name: 'Monastir — Marina',
    slug: 'monastir',
    address: 'Marina de Monastir, Monastir 5000, Tunisia',
    phone: '+216 73 462 118',
    latitude: 35.7776,
    longitude: 10.8262,
    serviceRadiusMeters: 180,
    tableCount: 24,
    kitchenSlaMinutes: 16,
    openingHours: STANDARD_HOURS,
  },
  {
    name: 'Tunis — Lac 2',
    slug: 'tunis',
    address: 'Rue du Lac Léman, Les Berges du Lac 2, Tunis 1053, Tunisia',
    phone: '+216 71 960 233',
    latitude: 36.8422,
    longitude: 10.2731,
    serviceRadiusMeters: 200,
    tableCount: 22,
    kitchenSlaMinutes: 14,
    openingHours: STANDARD_HOURS,
  },
];

export const ZONES = ['Terrace', 'Main hall', 'Window', 'Bar', 'Garden'];

export const REVIEW_COMMENTS = [
  'Ordering from the table was so easy — food arrived faster than expected.',
  'The double burger was excellent and the waiter came over within a minute of tapping the button.',
  'Loved being able to watch the order status. No more wondering where the food is.',
  'Pizza was perfect. Service a little slow at peak time but the staff were lovely.',
  'Great coffee and a beautiful terrace. Will be back.',
  'Tiramisu is the best I have had in Sousse.',
  'Everything was good, though one item was out of stock.',
  'Very smooth experience from scanning the code to paying the bill.',
  null,
  null,
];
