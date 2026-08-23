import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CheckCheck } from 'lucide-react';
import { api, staffTokens } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { IconButton } from '@/components/ui/primitives';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

const TYPE_TONES: Record<string, string> = {
  NEW_ORDER: 'bg-info-soft text-info',
  ORDER_STATUS: 'bg-accent-soft text-accent-strong',
  SERVICE_REQUEST: 'bg-warning-soft text-warning',
  BILL_REQUEST: 'bg-gold-soft text-gold',
  LOW_STOCK: 'bg-danger-soft text-danger',
  PAYMENT: 'bg-success-soft text-success',
  KITCHEN_DELAY: 'bg-danger-soft text-danger',
  NEW_REVIEW: 'bg-gold-soft text-gold',
  SYSTEM: 'bg-surface-sunken text-ink-muted',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ notifications: Notification[]; unread: number }>('/notifications?limit=25'),
    refetchInterval: 90_000,
  });

  useRealtimeInvalidation(socket, ['notification:new'], [['notifications']]);

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = query.data?.unread ?? 0;
  const notifications = query.data?.notifications ?? [];

  return (
    <div className="relative">
      <IconButton label="Notifications" size="sm" onClick={() => setOpen((value) => !value)}>
        <span className="relative">
          <Bell className="size-[1.0625rem]" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1 flex min-w-[1.05rem] items-center justify-center rounded-full bg-danger px-1 text-[0.5625rem] font-semibold leading-[1.05rem] text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </IconButton>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-overlay"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-sm font-semibold text-ink">Notifications</p>
                {unread > 0 && (
                  <button
                    onClick={() => markAll.mutate()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline"
                  >
                    <CheckCheck className="size-3.5" aria-hidden />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="scrollbar-slim max-h-[24rem] overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-ink-muted">Nothing to catch up on.</p>
                ) : (
                  <ul>
                    {notifications.map((notification) => (
                      <li key={notification.id}>
                        <button
                          onClick={() => !notification.readAt && markOne.mutate(notification.id)}
                          className={cn(
                            'flex w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-sunken',
                            !notification.readAt && 'bg-accent-soft/25',
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 size-2 shrink-0 rounded-full',
                              notification.readAt ? 'bg-line-strong' : 'bg-accent',
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[0.8125rem] font-medium leading-snug text-ink">
                              {notification.title}
                            </span>
                            {notification.body && (
                              <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                                {notification.body}
                              </span>
                            )}
                            <span className="mt-1 flex items-center gap-2">
                              <span
                                className={cn(
                                  'rounded px-1.5 py-px text-[0.5625rem] font-semibold uppercase tracking-wide',
                                  TYPE_TONES[notification.type] ?? TYPE_TONES.SYSTEM,
                                )}
                              >
                                {notification.type.replace(/_/g, ' ').toLowerCase()}
                              </span>
                              <span className="text-2xs text-ink-muted">
                                {relativeTime(notification.createdAt)}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
