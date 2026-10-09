// SEED composition: https://seed-design.io/react/components/action-button
import {
  ActionButton as SeedActionButton,
  LoadingIndicator,
  type ActionButtonProps,
} from '@seed-design/react';
import { forwardRef } from 'react';
import { ProgressCircle } from './progress-circle';

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ children, loading = false, ...props }, ref) => (
    <SeedActionButton {...props} ref={ref} loading={loading}>
      {loading ? (
        <LoadingIndicator
          indicator={<ProgressCircle size="inherit" tone="inherit" aria-hidden="true" />}
        >
          {children}
        </LoadingIndicator>
      ) : (
        children
      )}
    </SeedActionButton>
  ),
);
ActionButton.displayName = 'ActionButton';
