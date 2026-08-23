import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-8 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-surface-sunken text-ink-muted">
        <Compass className="size-6" strokeWidth={1.7} aria-hidden />
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
        That address does not lead anywhere in TableFlow. If you were trying to order, scan the QR code on
        your table again.
      </p>
      <Button className="mt-7" onClick={() => window.location.assign('/')}>
        Go home
      </Button>
      <Link to="/dev/qr" className="mt-3 text-xs font-medium text-ink-muted underline-offset-2 hover:underline">
        Open the QR Test Center
      </Link>
    </div>
  );
}
