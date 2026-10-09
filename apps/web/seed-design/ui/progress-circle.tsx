// SEED composition: https://seed-design.io/react/components/progress-circle
import { ProgressCircle as SeedProgressCircle } from '@seed-design/react';
import { forwardRef } from 'react';

export type ProgressCircleProps = Omit<SeedProgressCircle.RootProps, 'children' | 'asChild'>;

export const ProgressCircle = forwardRef<SVGSVGElement, ProgressCircleProps>((props, ref) => (
  <SeedProgressCircle.Root {...props} ref={ref}>
    <SeedProgressCircle.Track />
    <SeedProgressCircle.Range />
  </SeedProgressCircle.Root>
));
ProgressCircle.displayName = 'ProgressCircle';
