import { useEffect } from 'react';
import { X, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { useEventBus } from '../../store/eventBus';

const iconMap = {
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const colorMap = {
  info: 'border-blue-500/40 bg-blue-500/10 text-blue-400',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  error: 'border-red-500/40 bg-red-500/10 text-red-400',
};

export function Notifications() {
  const notifications = useEventBus((s) => s.notifications);
  const dismiss = useEventBus((s) => s.dismissNotification);

  // Auto-dismiss after 8s
  useEffect(() => {
    if (notifications.length === 0) return;
    const latest = notifications[notifications.length - 1];
    const timer = setTimeout(() => dismiss(latest.id), 8000);
    return () => clearTimeout(timer);
  }, [notifications, dismiss]);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.slice(-3).map((n) => {
        const Icon = iconMap[n.level];
        return (
          <div
            key={n.id}
            className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-[13px] shadow-lg animate-in slide-in-from-right ${colorMap[n.level]}`}
          >
            <Icon size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{n.message}</span>
            <button onClick={() => dismiss(n.id)} className="shrink-0 opacity-60 hover:opacity-100">
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
