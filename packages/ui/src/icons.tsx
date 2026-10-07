import { Icon, type IconProps } from '@iconify/react/offline';
import database from '@iconify-icons/lucide/database';
import databaseZap from '@iconify-icons/lucide/database-zap';
import fileDatabase from '@iconify-icons/lucide/file-spreadsheet';
import table from '@iconify-icons/lucide/table-2';
import columns from '@iconify-icons/lucide/columns-3';
import terminal from '@iconify-icons/lucide/square-terminal';
import settings from '@iconify-icons/lucide/sliders-horizontal';
import plug from '@iconify-icons/lucide/plug-zap';
import plus from '@iconify-icons/lucide/plus';
import close from '@iconify-icons/lucide/x';
import chevronDown from '@iconify-icons/lucide/chevron-down';
import chevronUp from '@iconify-icons/lucide/chevron-up';
import chevronRight from '@iconify-icons/lucide/chevron-right';
import check from '@iconify-icons/lucide/check';
import refresh from '@iconify-icons/lucide/refresh-cw';
import search from '@iconify-icons/lucide/search';
import play from '@iconify-icons/lucide/play';
import stop from '@iconify-icons/lucide/square';
import history from '@iconify-icons/lucide/history';
import log from '@iconify-icons/lucide/scroll-text';
import shield from '@iconify-icons/lucide/shield-check';
import sparkles from '@iconify-icons/lucide/sparkles';
import send from '@iconify-icons/lucide/arrow-up';
import arrowDown from '@iconify-icons/lucide/arrow-down';
import arrowRight from '@iconify-icons/lucide/arrow-right';
import sort from '@iconify-icons/lucide/arrow-up-down';
import monitor from '@iconify-icons/lucide/monitor';
import server from '@iconify-icons/lucide/server';
import save from '@iconify-icons/lucide/save';
import trash from '@iconify-icons/lucide/trash-2';
import loader from '@iconify-icons/lucide/loader-circle';
import expand from '@iconify-icons/lucide/maximize-2';
import collapse from '@iconify-icons/lucide/minimize-2';
import messagePlus from '@iconify-icons/lucide/message-square-plus';

import info from '@iconify-icons/lucide/info';
import warning from '@iconify-icons/lucide/triangle-alert';
import error from '@iconify-icons/lucide/circle-x';

// Static icon data only: no icon-name API lookup or external network dependency.
const icons = { expand, collapse, info, warning, error, database, databaseZap, fileDatabase, table, columns, terminal, settings, plug, plus, close, chevronDown, chevronUp, chevronRight, check, refresh, search, play, stop, history, log, shield, sparkles, send, arrowDown, arrowRight, sort, monitor, server, save, trash, loader, messagePlus };
export type AppIconName = keyof typeof icons;
type AppIconProps = Omit<IconProps, 'icon' | 'name'> & { name: AppIconName; size?: number };

// Icons are decorative. Their button/field owns the accessible name.
export function AppIcon({ name, size = 16, className = '', style, ...props }: AppIconProps) {
  return <Icon {...props} icon={icons[name]} width={size} height={size} className={`app-icon ${className}`} style={{ width: size, height: size, ...style }} aria-hidden="true" focusable="false" />;
}

// Keep the upstream shadcn component structure while using one icon renderer.
type PresetProps = Omit<AppIconProps, 'name'>;
export const CheckIcon = (props: PresetProps) => <AppIcon name="check" {...props} />;
export const ChevronDownIcon = (props: PresetProps) => <AppIcon name="chevronDown" {...props} />;
export const ChevronUpIcon = (props: PresetProps) => <AppIcon name="chevronUp" {...props} />;
export const XIcon = (props: PresetProps) => <AppIcon name="close" {...props} />;
