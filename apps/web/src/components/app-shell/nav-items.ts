import {
  FileText,
  LayoutDashboard,
  Link2,
  LineChart,
  NotebookPen,
  Search,
  Settings,
  Target,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  key:
    | 'dashboard'
    | 'keywords'
    | 'rankings'
    | 'competitors'
    | 'backlinks'
    | 'content'
    | 'reports'
    | 'settings';
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/app', icon: LayoutDashboard },
  { key: 'keywords', href: '/app/keywords', icon: Search },
  { key: 'rankings', href: '/app/rankings', icon: LineChart },
  { key: 'competitors', href: '/app/competitors', icon: Target },
  { key: 'backlinks', href: '/app/backlinks', icon: Link2 },
  { key: 'content', href: '/app/content', icon: NotebookPen },
  { key: 'reports', href: '/app/reports', icon: FileText },
  { key: 'settings', href: '/app/settings', icon: Settings },
];
