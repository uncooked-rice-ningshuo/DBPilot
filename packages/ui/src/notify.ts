import { toast } from 'sonner';

type NoticeOptions = { id?: string; title?: string };
// Stable IDs replace repeated polling errors instead of creating an unbounded stack.
export const notify = {
  error(message: string, options?: NoticeOptions) {
    if (message) toast.error(options?.title ?? '操作失败', { id: options?.id ?? `error:${message}`, description: message, duration: 8000 });
  },
  success(message: string, options?: NoticeOptions) {
    if (message) toast.success(options?.title ?? '操作成功', { id: options?.id ?? `success:${message}`, description: message });
  },
  warning(message: string, options?: NoticeOptions) {
    if (message) toast.warning(options?.title ?? '请留意', { id: options?.id ?? `warning:${message}`, description: message, duration: 10000 });
  },
};
