'use client';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Me } from '@seo/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@seo/ui/avatar';
import { Button } from '@seo/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@seo/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function UserMenu({ me }: { me: Me }) {
  const t = useTranslations();
  const role = me.activeOrganization?.role;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={t('shell.account')}
        >
          <Avatar>
            {me.user.image && <AvatarImage src={me.user.image} alt="" />}
            <AvatarFallback>{initials(me.user.name || me.user.email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="font-normal">
          <div className="text-foreground text-sm font-medium">{me.user.name}</div>
          <div className="truncate text-xs">{me.user.email}</div>
          {role && <div className="mt-1 text-xs">{t(`roles.${role}`)}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            window.location.assign(
              window.location.pathname.startsWith('/en') ? '/en/sign-in' : '/sign-in',
            );
          }}
        >
          <LogOut aria-hidden /> {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
