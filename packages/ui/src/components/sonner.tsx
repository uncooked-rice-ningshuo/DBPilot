// Adapted from shadcn/ui new-york-v4/sonner (2026-10-07); see packages/ui/README.md.
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { AppIcon } from '../icons';

export function Toaster(props: ToasterProps) {
  return createPortal(<div data-notification-layer style={{ display: 'contents' }}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}>
    <Sonner
    theme="light"
    position="bottom-right"
    containerAriaLabel="操作通知"
    className="toaster dbpilot-toaster"
    offset={20}
    mobileOffset={12}
    visibleToasts={3}
    closeButton
    duration={4500}
    icons={{ success: <AppIcon name="check" />, info: <AppIcon name="info" />, warning: <AppIcon name="warning" />, error: <AppIcon name="error" />, loading: <AppIcon name="loader" className="icon-spin" /> }}
    style={{ '--normal-bg': 'var(--popover)', '--normal-text': 'var(--popover-foreground)', '--normal-border': 'var(--border)', '--border-radius': 'var(--radius)' } as CSSProperties}
    toastOptions={{ className: 'dbpilot-toast', closeButtonAriaLabel: '关闭提示' }}
    {...props}
  /></div>, document.body);
}
