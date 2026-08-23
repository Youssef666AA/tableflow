import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Star } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { Button, Select, Textarea } from '@/components/ui/primitives';
import { Pagination, StatCard } from '@/components/ui/data';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';
import { Page, PageHeading } from '@/console/PageShell';
import type { AdminReview } from '../types';

interface ReviewsPayload {
  reviews: AdminReview[];
  summary: { average: number | null; count: number };
  pagination: { page: number; pageSize: number; total: number; pages: number };
}

export default function ReviewsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [rating, setRating] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [response, setResponse] = useState('');

  const query = useQuery({
    queryKey: ['reviews', page, rating],
    queryFn: () =>
      api.get<ReviewsPayload>(`/reviews?page=${page}&pageSize=20${rating ? `&rating=${rating}` : ''}`),
  });

  const respond = useMutation({
    mutationFn: (id: string) => api.post(`/reviews/${id}/respond`, { response: response.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
      setReplyingTo(null);
      setResponse('');
      toast.success('Reply saved');
    },
    onError: (error) =>
      toast.error('Could not save the reply', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const data = query.data;
  const reviews = data?.reviews ?? [];

  const distribution = [5, 4, 3, 2, 1].map((value) => ({
    rating: value,
    count: reviews.filter((review) => review.rating === value).length,
  }));

  return (
    <Page width="narrow">
      <PageHeading
        title="Reviews"
        description="Only guests who were actually served can leave one."
        actions={
          <Select
            value={rating}
            onChange={(event) => {
              setRating(event.target.value);
              setPage(1);
            }}
            className="w-40"
            aria-label="Filter by rating"
          >
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value} star{value === 1 ? '' : 's'}
              </option>
            ))}
          </Select>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Average rating"
          value={data?.summary.average ? data.summary.average.toFixed(1) : '—'}
          sublabel="out of 5"
          icon={<Star className="size-4" />}
          tone="accent"
          loading={query.isLoading}
        />
        <StatCard label="Total reviews" value={data?.summary.count ?? 0} loading={query.isLoading} />
        <div className="rounded-lg border border-line bg-surface p-4 shadow-subtle">
          <p className="mb-2 text-[0.8125rem] font-medium text-ink-muted">This page</p>
          <ul className="space-y-1">
            {distribution.map((row) => {
              const max = Math.max(...distribution.map((entry) => entry.count), 1);
              return (
                <li key={row.rating} className="flex items-center gap-2">
                  <span className="tabular w-3 text-2xs text-ink-muted">{row.rating}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <span
                      className="block h-full rounded-full bg-gold"
                      style={{ width: `${(row.count / max) * 100}%` }}
                    />
                  </span>
                  <span className="tabular w-5 text-right text-2xs text-ink-muted">{row.count}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {query.isLoading && <LoadingRows rows={4} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && reviews.length === 0 && (
        <EmptyState
          icon={<MessageSquare className="size-5" />}
          title="No reviews yet"
          description="Guests are invited to review once their order has been served."
        />
      )}

      <div className="space-y-3">
        {reviews.map((review) => (
          <article key={review.id} className="rounded-lg border border-line bg-surface p-4 shadow-subtle">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      className={cn('size-4', index < review.rating ? 'fill-gold text-gold' : 'text-line-strong')}
                      aria-hidden
                    />
                  ))}
                  <span className="tabular ml-1.5 text-sm font-semibold text-ink">{review.rating}.0</span>
                </div>
                <p className="mt-1 text-2xs text-ink-muted">
                  {review.branchName}
                  {review.tableNumber ? ` · table ${review.tableNumber}` : ''} · {formatDateTime(review.createdAt)}
                  {review.customerName ? ` · ${review.customerName}` : ''}
                </p>
              </div>
              <div className="flex gap-3 text-2xs text-ink-muted">
                {review.foodRating != null && <span>Food {review.foodRating}/5</span>}
                {review.serviceRating != null && <span>Service {review.serviceRating}/5</span>}
              </div>
            </div>

            {review.comment && (
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">“{review.comment}”</p>
            )}

            {review.response && (
              <div className="mt-3 rounded-md border-l-2 border-accent bg-accent-soft/40 px-3.5 py-2.5">
                <p className="text-2xs font-semibold uppercase tracking-wider text-accent-strong">
                  Your reply
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{review.response}</p>
              </div>
            )}

            {can('reviews:manage') && !review.response && (
              <div className="mt-3">
                {replyingTo === review.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={response}
                      onChange={(event) => setResponse(event.target.value)}
                      rows={2}
                      placeholder="Thank them, or put something right."
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setReplyingTo(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        loading={respond.isPending}
                        disabled={!response.trim()}
                        onClick={() => respond.mutate(review.id)}
                      >
                        Reply
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setReplyingTo(review.id);
                      setResponse('');
                    }}
                  >
                    Reply
                  </Button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      {data && (
        <Pagination
          page={data.pagination.page}
          pages={data.pagination.pages}
          total={data.pagination.total}
          pageSize={data.pagination.pageSize}
          onChange={setPage}
        />
      )}
    </Page>
  );
}
