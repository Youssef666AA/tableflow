import crypto from 'node:crypto';

/**
 * TableFlow's built-in demo payment provider.
 *
 * It processes nothing. No card network is contacted, no money moves. What it
 * does is model the *states* a real provider produces — approved, declined for a
 * specific reason — against deterministic test cards, so the billing flow,
 * receipts and analytics can be exercised end to end without a Stripe key.
 *
 * The `PaymentProvider` shape below is the seam a real gateway would slot into.
 */

export interface MockCard {
  cardNumber: string;
  expiry: string;
  cvc: string;
  holder: string;
}

export interface ChargeInput {
  amount: number;
  card?: MockCard;
}

export interface ChargeOutcome {
  status: 'PAID' | 'FAILED';
  reference: string;
  failureReason: string | null;
}

export interface PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly simulated: boolean;
  charge(input: ChargeInput): ChargeOutcome | Promise<ChargeOutcome>;
}

/** Deterministic test cards, in the spirit of a real gateway's sandbox. */
export const TEST_CARDS = {
  approved: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
  expired: '4000000000000069',
} as const;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (Number.isNaN(value)) return false;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function expiryInPast(expiry: string): boolean {
  const match = /^(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(expiry.trim());
  if (!match) return true;
  const month = Number(match[1]);
  const yearPart = Number(match[2]);
  const year = yearPart < 100 ? 2000 + yearPart : yearPart;
  if (month < 1 || month > 12) return true;
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
  return endOfMonth.getTime() < Date.now();
}

function reference(): string {
  return `DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

export function chargeMockCard(input: ChargeInput): ChargeOutcome {
  const card = input.card;
  if (!card) {
    return { status: 'FAILED', reference: reference(), failureReason: 'Card details are required.' };
  }

  const digits = card.cardNumber.replace(/\D/g, '');

  if (digits.length < 12 || !luhnValid(digits)) {
    return { status: 'FAILED', reference: reference(), failureReason: 'That card number is not valid.' };
  }
  if (!/^\d{3,4}$/.test(card.cvc)) {
    return { status: 'FAILED', reference: reference(), failureReason: 'The security code is not valid.' };
  }
  if (expiryInPast(card.expiry) || digits === TEST_CARDS.expired) {
    return { status: 'FAILED', reference: reference(), failureReason: 'That card has expired.' };
  }
  if (digits === TEST_CARDS.declined) {
    return { status: 'FAILED', reference: reference(), failureReason: 'The card was declined by the issuer.' };
  }
  if (digits === TEST_CARDS.insufficientFunds) {
    return { status: 'FAILED', reference: reference(), failureReason: 'Insufficient funds.' };
  }
  if (input.amount <= 0) {
    return { status: 'FAILED', reference: reference(), failureReason: 'Invalid amount.' };
  }

  return { status: 'PAID', reference: reference(), failureReason: null };
}

export const mockProvider: PaymentProvider = {
  id: 'mock',
  displayName: 'Demo online payment',
  simulated: true,
  charge: chargeMockCard,
};

/**
 * Registry of available providers. Adding Stripe means implementing
 * `PaymentProvider` and registering it here — no call site changes.
 */
const providers = new Map<string, PaymentProvider>([[mockProvider.id, mockProvider]]);

export function registerProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): PaymentProvider {
  const provider = providers.get(id);
  if (!provider) throw new Error(`Unknown payment provider: ${id}`);
  return provider;
}

export function listProviders(): Array<{ id: string; displayName: string; simulated: boolean }> {
  return [...providers.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    simulated: p.simulated,
  }));
}
