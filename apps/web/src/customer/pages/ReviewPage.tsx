import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Heart, Star } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/overlays';
import { PageHeader } from '../components/shell';
import { useSession, useSessionAuth } from '../session';

interface ExistingReview {
  id: string;
  rating: number;
  foodRating: number | null;
  serviceRating: number | null;
  comment: string | null;
  createdAt: string;
}

const RATING_WORDS = ['', 'Poor', 'Not great', 'Fine', 'Very good', 'Excellent'];

export default function ReviewPage() {
  const { data } = useSession();
  const auth = useSessionAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [rating, setRating] = useState(0);
  const [foodRating, setFoodRating] = useState(0);
  const [serviceRating, setServiceRating] = useState(0);
  const [comment, setComment] = useState('');

  const existing = useQuery({
    queryKey: ['customer', 'review', data.session.id],
    queryFn: () => api.get<{ review: ExistingReview | null }>('/customer/review', auth),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post(
        '/customer/review',
        {
          rating,
          foodRating: foodRating || null,
          serviceRating: serviceRating || null,
          comment: comment.trim() || null,
        },
        auth,
      ),
    onSuccess: () => {
      toast.success('Thank you', 'Your feedback goes straight to the restaurant.');
      void existing.refetch();
    },
    onError: (error) =>
      toast.error(
        'We could not save your review',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  if (existing.data?.review) {
    const review = existing.data.review;
    return (
      <div className="mx-auto max-w-phone px-4 pb-32">
        <PageHeader title="Thanks for your feedback" />
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-4 rounded-lg border border-line bg-surface p-6 text-center shadow-subtle"
        >
          <Heart className="mx-auto mb-3 size-7 fill-accent-soft text-accent" aria-hidden />
          <div className="flex justify-center gap-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star
                key={index}
                className={cn(
                  'size-6',
                  index < review.rating ? 'fill-gold text-gold' : 'text-line-strong',
                )}
                aria-hidden
              />
            ))}
          </div>
          <p className="mt-3 text-sm font-medium text-ink">{RATING_WORDS[review.rating]}</p>
          {review.comment && (
            <p className="mt-2 text-sm italic leading-relaxed text-ink-muted">“{review.comment}”</p>
          )}
          <p className="mt-4 text-xs text-ink-muted">
            {data.restaurant.name} will see this alongside your visit.
          </p>
        </motion.div>

        <Button variant="secondary" size="lg" fullWidth className="mt-4" onClick={() => navigate('../menu')}>
          Back to the menu
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-phone px-4 pb-32">
      <PageHeader
        title="How was your experience?"
        description={`Your feedback helps ${data.restaurant.name} get better.`}
      />

      <section className="mt-5 rounded-lg border border-line bg-surface p-5 shadow-subtle">
        <StarRow label="Overall" value={rating} onChange={setRating} large />
        {rating > 0 && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-center text-sm font-medium text-accent-strong"
          >
            {RATING_WORDS[rating]}
          </motion.p>
        )}

        <div className="mt-6 space-y-4 border-t border-line pt-5">
          <StarRow label="Food" value={foodRating} onChange={setFoodRating} />
          <StarRow label="Service" value={serviceRating} onChange={setServiceRating} />
        </div>
      </section>

      <div className="mt-4">
        <label htmlFor="review-comment" className="mb-1.5 block text-[0.8125rem] font-medium text-ink-soft">
          Tell us more <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <Textarea
          id="review-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="What stood out? Anything we could do better?"
          rows={4}
          maxLength={1000}
        />
      </div>

      <Button
        size="xl"
        fullWidth
        className="mt-5"
        disabled={rating === 0}
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Send feedback
      </Button>

      <p className="mt-3 text-center text-2xs leading-relaxed text-ink-muted">
        Reviews can only be left after an order has been served, so every rating comes from a real visit.
      </p>
    </div>
  );
}

function StarRow({
  label,
  value,
  onChange,
  large,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  large?: boolean;
}) {
  return (
    <div className={cn(large ? 'text-center' : 'flex items-center justify-between gap-4')}>
      <span className={cn('text-sm font-medium text-ink-soft', large && 'mb-3 block')}>{label}</span>
      <div className={cn('flex gap-1.5', large && 'justify-center')}>
        {Array.from({ length: 5 }).map((_, index) => {
          const starValue = index + 1;
          return (
            <button
              key={starValue}
              type="button"
              aria-label={`${starValue} star${starValue === 1 ? '' : 's'} for ${label}`}
              onClick={() => onChange(starValue)}
              className="transition-transform active:scale-90"
            >
              <Star
                className={cn(
                  large ? 'size-9' : 'size-6',
                  starValue <= value ? 'fill-gold text-gold' : 'text-line-strong hover:text-gold/50',
                )}
                strokeWidth={1.5}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
