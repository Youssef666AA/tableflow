import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hand, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/overlays';
import { useSession, useSessionAuth } from '../session';

type Phase = 'intro' | 'locating' | 'denied' | 'unavailable' | 'timeout' | 'out-of-range' | 'blocked';

interface OutOfRangeDetails {
  distanceMeters?: number;
  allowedRadiusMeters?: number;
  staffOverrideAvailable?: boolean;
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 12_000,
  maximumAge: 30_000,
};

/**
 * Location verification.
 *
 * The guest is told plainly why their location is needed, and every failure mode
 * — refused permission, no signal, a timeout, being genuinely too far away — has
 * its own honest screen and its own way forward.
 */
export default function VerifyPage() {
  const { data, refresh } = useSession();
  const auth = useSessionAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>('intro');
  const [details, setDetails] = useState<OutOfRangeDetails>({});
  const [busy, setBusy] = useState(false);

  // Already verified (or the branch does not ask): straight to the menu.
  useEffect(() => {
    if (data.verified) navigate('../menu', { replace: true });
  }, [data.verified, navigate]);

  const submit = async (payload: { latitude: number; longitude: number; accuracy?: number | null; simulate?: boolean }) => {
    setBusy(true);
    try {
      await api.post('/customer/session/verify-location', payload, auth);
      await refresh();
      toast.success("You're all set", 'Enjoy the menu.');
      navigate('../menu', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'LOCATION_OUT_OF_RANGE') {
        setDetails((error.details ?? {}) as OutOfRangeDetails);
        setPhase('out-of-range');
      } else if (error instanceof ApiError && error.code === 'SESSION_BLOCKED') {
        setPhase('blocked');
      } else if (error instanceof ApiError) {
        toast.error('We could not verify your location', error.message);
        setPhase('intro');
      } else {
        toast.error('Something went wrong', 'Please try again.');
        setPhase('intro');
      }
    } finally {
      setBusy(false);
    }
  };

  const requestLocation = () => {
    if (!('geolocation' in navigator)) {
      setPhase('unavailable');
      return;
    }

    setPhase('locating');
    navigator.geolocation.getCurrentPosition(
      (position) =>
        void submit({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setPhase('denied');
        else if (error.code === error.TIMEOUT) setPhase('timeout');
        else setPhase('unavailable');
      },
      GEO_OPTIONS,
    );
  };

  const simulate = () => void submit({ latitude: data.branch.latitude, longitude: data.branch.longitude, simulate: true });

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-phone flex-col px-6 pb-10 pt-[calc(2rem+env(safe-area-inset-top,0px))]">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-1 flex-col"
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-accent-soft">
            {phase === 'locating' && (
              <span className="absolute inset-0 animate-pulse-ring rounded-2xl bg-accent/25" aria-hidden />
            )}
            <MapPin className="relative size-7 text-accent-strong" strokeWidth={1.8} aria-hidden />
          </div>

          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent-strong">
            {data.restaurant.name}
          </p>
          <h1 className="mt-2 font-display text-[1.625rem] font-semibold leading-tight tracking-tight text-ink">
            {headline(phase)}
          </h1>
          <p className="mt-3 max-w-[26rem] text-sm leading-relaxed text-ink-muted">{body(phase, data, details)}</p>
        </div>

        <div className="rounded-lg border border-line bg-surface p-4 shadow-subtle">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-muted">Table</span>
            <span className="font-display text-lg font-semibold text-ink">{data.table.number}</span>
          </div>
          <div className="mt-3 flex items-start justify-between gap-3 border-t border-line pt-3">
            <span className="shrink-0 text-sm text-ink-muted">Location</span>
            <span className="text-right text-sm text-ink">{data.branch.address ?? data.branch.name}</span>
          </div>
        </div>

        {phase === 'out-of-range' && details.distanceMeters != null && (
          <div className="mt-4 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3">
            <p className="text-xs leading-relaxed text-danger">
              You appear to be about{' '}
              <strong className="tabular">{formatDistance(details.distanceMeters)}</strong> from the restaurant.
              Ordering is allowed within {details.allowedRadiusMeters ?? data.branch.serviceRadiusMeters} m.
            </p>
          </div>
        )}

        <div className="mt-auto space-y-3 pt-8">
          {phase !== 'blocked' && (
            <Button size="xl" fullWidth loading={busy || phase === 'locating'} onClick={requestLocation}>
              {phase === 'intro' ? 'Confirm I am at this table' : 'Try again'}
            </Button>
          )}

          {data.demoMode && phase !== 'blocked' && (
            <Button size="lg" variant="secondary" fullWidth onClick={simulate} disabled={busy}>
              <Sparkles className="size-4 text-gold" aria-hidden />
              Simulate being at the restaurant
            </Button>
          )}

          {(phase === 'denied' || phase === 'unavailable' || phase === 'timeout' || phase === 'out-of-range') &&
            data.branch.allowStaffLocationOverride && (
              <div className="flex items-start gap-2.5 rounded-md bg-surface-sunken px-3.5 py-3">
                <Hand className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                <p className="text-xs leading-relaxed text-ink-muted">
                  Still stuck? A member of staff can confirm you are seated at table {data.table.number} from
                  their own device.
                </p>
              </div>
            )}

          <p className="flex items-start gap-2 pt-1 text-2xs leading-relaxed text-ink-muted">
            <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
            Your location is checked once, used only to confirm you are at the restaurant, and never shared.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function headline(phase: Phase): string {
  switch (phase) {
    case 'locating':
      return 'Checking you are here…';
    case 'denied':
      return 'Location permission needed';
    case 'unavailable':
      return "We couldn't get your location";
    case 'timeout':
      return 'That took too long';
    case 'out-of-range':
      return "You're outside the restaurant";
    case 'blocked':
      return 'Please ask a member of staff';
    default:
      return "Let's confirm you're at the table";
  }
}

function body(
  phase: Phase,
  data: ReturnType<typeof useSession>['data'],
  details: OutOfRangeDetails,
): string {
  switch (phase) {
    case 'locating':
      return 'One moment while your device works out where you are.';
    case 'denied':
      return 'Your browser blocked the location request. Allow location for this site in your browser settings, then try again.';
    case 'unavailable':
      return 'Your device could not provide a location. Moving near a window often helps.';
    case 'timeout':
      return 'Your device did not answer in time. This usually works on a second attempt.';
    case 'out-of-range':
      return details.staffOverrideAvailable
        ? 'Please scan the QR code from your table, or ask a member of staff to confirm your table for you.'
        : 'Please scan the QR code printed on your table to order.';
    case 'blocked':
      return 'This device has been blocked after too many failed checks. A member of staff can unblock it for you.';
    default:
      return `Your location is used to verify that you're at ${data.restaurant.name} before placing an order. It takes a second.`;
  }
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
