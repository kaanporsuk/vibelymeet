import { toast } from "sonner";

type AdminToastAction = {
  label: string;
  onClick: () => void;
};

type AdminToastOptions = {
  id: string;
  title: string;
  description?: string;
  action?: AdminToastAction;
  duration?: number;
};

type ToastKind = "success" | "error" | "warning" | "info";

const DEFAULT_ADMIN_TOAST_DURATION = 5200;

function showAdminToast(kind: ToastKind, options: AdminToastOptions) {
  const payload = {
    id: options.id,
    description: options.description,
    action: options.action,
    duration: options.duration ?? DEFAULT_ADMIN_TOAST_DURATION,
  };

  if (kind === "success") return toast.success(options.title, payload);
  if (kind === "error") return toast.error(options.title, payload);
  if (kind === "warning") return toast.warning(options.title, payload);
  return toast.info(options.title, payload);
}

export const adminToast = {
  success: (options: AdminToastOptions) => showAdminToast("success", options),
  error: (options: AdminToastOptions) => showAdminToast("error", options),
  warning: (options: AdminToastOptions) => showAdminToast("warning", options),
  info: (options: AdminToastOptions) => showAdminToast("info", options),
};
