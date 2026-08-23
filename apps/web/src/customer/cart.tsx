import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PricedOrder } from '@tableflow/shared';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { useSession, useSessionAuth } from './session';

export interface CartLine {
  /** Local identity so two configurations of the same dish stay distinct. */
  key: string;
  productId: string;
  productName: string;
  imageUrl: string | null;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
  modifierOptionIds: string[];
  modifierLabels: string[];
  notes: string | null;
  /** Client-side estimate, replaced by the server quote before checkout. */
  estimatedUnitPrice: number;
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  estimatedTotal: number;
  /** Server-computed pricing; null until the first quote lands. */
  quote: PricedOrder | null;
  quoteLoading: boolean;
  quoteError: unknown;
  add: (line: Omit<CartLine, 'key'>) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  updateNotes: (key: string, notes: string | null) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside a CartProvider');
  return context;
}

function storageKey(sessionId: string) {
  return `tf.cart.${sessionId}`;
}

function signatureOf(line: Omit<CartLine, 'key'>): string {
  return [line.productId, line.variantId ?? '', [...line.modifierOptionIds].sort().join('|'), line.notes ?? '']
    .join('::');
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { data } = useSession();
  const auth = useSessionAuth();
  const sessionId = data.session.id;

  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey(sessionId));
      return stored ? (JSON.parse(stored) as CartLine[]) : [];
    } catch {
      return [];
    }
  });

  // The cart survives a reload, a locked phone or an accidental back gesture.
  useEffect(() => {
    try {
      if (lines.length === 0) window.localStorage.removeItem(storageKey(sessionId));
      else window.localStorage.setItem(storageKey(sessionId), JSON.stringify(lines));
    } catch {
      // Storage refused; the cart still lives in memory for this visit.
    }
  }, [lines, sessionId]);

  const add = useCallback((line: Omit<CartLine, 'key'>) => {
    setLines((current) => {
      const signature = signatureOf(line);
      const existing = current.find((candidate) => signatureOf(candidate) === signature);
      if (existing) {
        return current.map((candidate) =>
          candidate.key === existing.key
            ? { ...candidate, quantity: Math.min(50, candidate.quantity + line.quantity) }
            : candidate,
        );
      }
      return [...current, { ...line, key: `${signature}::${Date.now().toString(36)}` }];
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.key !== key)
        : current.map((line) => (line.key === key ? { ...line, quantity: Math.min(50, quantity) } : line)),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  }, []);

  const updateNotes = useCallback((key: string, notes: string | null) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, notes } : line)));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const payload = useMemo(
    () =>
      lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        modifierOptionIds: line.modifierOptionIds,
        notes: line.notes,
      })),
    [lines],
  );

  const debouncedPayload = useDebounced(payload, 250);

  // The server prices the cart; the client estimate is only for instant feedback.
  const quoteQuery = useQuery({
    queryKey: ['customer', 'quote', sessionId, debouncedPayload],
    queryFn: () => api.post<PricedOrder>('/customer/cart/quote', { lines: debouncedPayload }, auth),
    enabled: debouncedPayload.length > 0,
    staleTime: 15_000,
    retry: false,
  });

  const value: CartContextValue = {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    estimatedTotal: lines.reduce((sum, line) => sum + line.estimatedUnitPrice * line.quantity, 0),
    quote: lines.length === 0 ? null : (quoteQuery.data ?? null),
    quoteLoading: quoteQuery.isFetching,
    quoteError: quoteQuery.error,
    add,
    setQuantity,
    remove,
    updateNotes,
    clear,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
