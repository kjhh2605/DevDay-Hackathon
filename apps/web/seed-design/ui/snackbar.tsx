// SEED composition: https://seed-design.io/react/components/snackbar
import { Snackbar as SeedSnackbar, useSnackbarAdapter } from '@seed-design/react';
import type { ReactNode } from 'react';

export function SnackbarProvider({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <SeedSnackbar.RootProvider>
      {children}
      <SeedSnackbar.Region className={className}>
        <SeedSnackbar.Renderer />
      </SeedSnackbar.Region>
    </SeedSnackbar.RootProvider>
  );
}

export function Snackbar({ message, className }: { message: string; className?: string }) {
  return (
    <SeedSnackbar.Root className={className}>
      <SeedSnackbar.Content>
        <SeedSnackbar.Message>{message}</SeedSnackbar.Message>
      </SeedSnackbar.Content>
      <SeedSnackbar.HiddenCloseButton aria-label="알림 닫기" />
    </SeedSnackbar.Root>
  );
}

export { useSnackbarAdapter };
