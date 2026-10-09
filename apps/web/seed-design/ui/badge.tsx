// SEED v3 Badge is a compound component.
// https://seed-design.io/react/components/badge
import { Badge as SeedBadge } from '@seed-design/react';
import { forwardRef } from 'react';

export const Badge = forwardRef<HTMLSpanElement, SeedBadge.RootProps>(
  ({ children, ...props }, ref) => (
    <SeedBadge.Root {...props} ref={ref}>
      <SeedBadge.Label>{children}</SeedBadge.Label>
    </SeedBadge.Root>
  ),
);
Badge.displayName = 'Badge';
