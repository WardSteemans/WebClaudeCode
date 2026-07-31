import { useEventBus, type PermissionRequest } from '../../store/eventBus';

interface PermissionBarProps {
  /** Callback when user approves a permission request */
  onApprove: (req: PermissionRequest) => void;
  /** Callback when user denies a permission request */
  onDeny: (req: PermissionRequest) => void;
  /** Additional PTY-mode approval (not in the eventBus queue) */
  ptyApprovalPending?: boolean;
  /** Callback for PTY-mode approve */
  onPtyApprove?: () => void;
  /** Callback for PTY-mode deny */
  onPtyDeny?: () => void;
}

const RISK_COLORS: Record<string, string> = {
  high: 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20',
  medium: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20',
  low: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20',
};

const RISK_TEXT: Record<string, string> = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-blue-600 dark:text-blue-400',
};

export function PermissionBar({ onApprove, onDeny, ptyApprovalPending, onPtyApprove, onPtyDeny }: PermissionBarProps) {
  const queue = useEventBus(s => s.permissionQueue);
  const approvePermission = useEventBus(s => s.approvePermission);
  const denyPermission = useEventBus(s => s.denyPermission);

  const hasQueueItems = queue.length > 0;
  const hasPtyPending = ptyApprovalPending && onPtyApprove && onPtyDeny;

  if (!hasQueueItems && !hasPtyPending) return null;

  const handleApprove = (req: PermissionRequest) => {
    onApprove(req);
    approvePermission(req.id);
  };

  const handleDeny = (req: PermissionRequest) => {
    onDeny(req);
    denyPermission(req.id);
  };

  return (
    <div className="shrink-0 space-y-1.5 px-4 py-2 border-t border-[var(--color-border)]">
      {/* Stream-json permission queue */}
      {queue.map(req => (
        <div
          key={req.id}
          className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${RISK_COLORS[req.risk] || RISK_COLORS.medium}`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-semibold uppercase ${RISK_TEXT[req.risk] || RISK_TEXT.medium}`}>
                {req.risk}
              </span>
              <span className="text-xs font-medium text-[var(--color-text)] truncate">
                {req.toolName}
              </span>
            </div>
            {req.description && (
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">
                {req.description}
              </p>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => handleApprove(req)}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => handleDeny(req)}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      ))}

      {/* PTY-mode approval prompt */}
      {hasPtyPending && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">
                prompt
              </span>
              <span className="text-xs font-medium text-[var(--color-text)]">
                Claude needs permission
              </span>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              Respond to the permission prompt in the terminal output above
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={onPtyApprove}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={onPtyDeny}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
