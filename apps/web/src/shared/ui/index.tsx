import { Skeleton as SeedSkeleton } from '@seed-design/react';
import type { Job } from '@devday/contracts';
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { ActionButton } from 'seed-design/ui/action-button';
import { TextField, TextFieldInput, TextFieldTextarea } from 'seed-design/ui/text-field';
import {
  DialogRoot,
  DialogPortal,
  DialogPositioner,
  DialogBackdrop,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogCloseButton,
} from 'seed-design/ui/dialog';
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionTitle,
  AccordionSuffixIcon,
  AccordionContent,
  AccordionBody,
} from 'seed-design/ui/accordion';
import { TabsRoot, TabsList, TabsTrigger, TabsIndicator, TabsContent } from 'seed-design/ui/tabs';
import { Badge as SeedBadge } from 'seed-design/ui/badge';
import { ProgressCircle } from 'seed-design/ui/progress-circle';
import {
  SnackbarProvider as SeedSnackbarProvider,
  Snackbar,
  useSnackbarAdapter,
} from 'seed-design/ui/snackbar';
import styles from './ui.module.css';

const cx = (...classes: (string | undefined | false)[]) => classes.filter(Boolean).join(' ');

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
}

const buttonVariants = {
  primary: 'brandSolid',
  secondary: 'neutralOutline',
  ghost: 'ghost',
  danger: 'criticalSolid',
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      className,
      disabled,
      type = 'button',
      color,
      style,
      ...props
    },
    ref,
  ) => (
    <ActionButton
      {...props}
      ref={ref}
      type={type}
      variant={buttonVariants[variant]}
      size={size === 'sm' ? 'small' : 'medium'}
      loading={loading}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={{ ...style, ...(color ? { color } : {}) }}
      className={cx(styles.button, styles[variant], size === 'sm' && styles.small, className)}
    />
  ),
);
Button.displayName = 'Button';

interface FieldMeta {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
}
export interface FieldProps extends InputHTMLAttributes<HTMLInputElement>, FieldMeta {}
export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldMeta {}

export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, hint, error, className, id, required, disabled, readOnly, name, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <TextField
        label={label}
        description={hint}
        errorMessage={error}
        invalid={Boolean(error)}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        inputId={inputId}
        className={styles.field}
        labelClassName={styles.fieldLabel}
        controlClassName={styles.fieldControl}
        footerClassName={styles.fieldFooter}
      >
        <TextFieldInput
          {...props}
          required={required}
          id={inputId}
          ref={ref}
          className={cx(styles.input, className)}
        />
      </TextField>
    );
  },
);
Field.displayName = 'Field';

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    { label, hint, error, className, id, required, disabled, readOnly, name, rows = 4, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <TextField
        label={label}
        description={hint}
        errorMessage={error}
        invalid={Boolean(error)}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        inputId={inputId}
        className={styles.field}
        labelClassName={styles.fieldLabel}
        controlClassName={styles.fieldControl}
        footerClassName={styles.fieldFooter}
      >
        <TextFieldTextarea
          {...props}
          required={required}
          id={inputId}
          ref={ref}
          rows={rows}
          autoresize={false}
          className={cx(styles.input, styles.textarea, className)}
        />
      </TextField>
    );
  },
);
TextArea.displayName = 'TextArea';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div {...props} ref={ref} className={cx(styles.card, className)} />
  ),
);
Card.displayName = 'Card';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span aria-hidden="true" className={styles.icon} style={{ fontSize: size }}>
      {name}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  icon = 'auto_awesome',
  children,
}: {
  title: string;
  description?: string;
  icon?: string | ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}>
        {typeof icon === 'string' ? <Icon name={icon} size={28} /> : icon}
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}

export function JobStatus({
  job,
  status,
  error,
}: {
  job?: Job | null;
  status?: 'running' | 'succeeded' | 'failed';
  error?: string | null;
}) {
  const currentStatus = job?.status ?? status;
  if (!currentStatus) return null;
  const failed = currentStatus === 'failed';
  const running = currentStatus === 'running';
  const message = failed
    ? (job?.error?.message ?? error ?? '처리하지 못했어요. 다시 시도해 주세요.')
    : running
      ? '잠시만요, 준비하고 있어요.'
      : '완료했어요.';
  return (
    <div
      className={cx(
        styles.jobStatus,
        failed ? styles.failure : running ? styles.pending : styles.success,
      )}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
    >
      {running ? (
        <ProgressCircle size="24" tone="brand" aria-label="처리 중" className={styles.progress} />
      ) : (
        <Icon name={failed ? 'error' : 'check_circle'} size={18} />
      )}
      <span>{message}</span>
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : '요청을 완료하지 못했어요. 다시 시도해 주세요.';
  const requestId =
    typeof error === 'object' && 'requestId' in error && typeof error.requestId === 'string'
      ? error.requestId
      : null;
  return (
    <div role="alert" className={styles.errorMessage}>
      <Icon name="error" size={18} />
      <div className={styles.errorCopy}>
        <span>{message}</span>
        {requestId && <small className={styles.requestId}>요청 ID: {requestId}</small>}
      </div>
    </div>
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange} closeOnInteractOutside={false}>
      <DialogPortal>
        <DialogPositioner className={styles.dialogPositioner}>
          <DialogBackdrop className={styles.dialogBackdrop} />
          <DialogContent className={styles.dialogContent}>
            <DialogHeader className={styles.dialogHeader}>
              <DialogTitle className={styles.dialogTitle}>{title}</DialogTitle>
              {description && (
                <DialogDescription className={styles.dialogDescription}>
                  {description}
                </DialogDescription>
              )}
              <DialogCloseButton aria-label="닫기" className={styles.dialogClose}>
                <Icon name="close" />
              </DialogCloseButton>
            </DialogHeader>
            <DialogBody className={styles.dialogBody}>{children}</DialogBody>
          </DialogContent>
        </DialogPositioner>
      </DialogPortal>
    </DialogRoot>
  );
}

type BadgeTone = 'brand' | 'neutral' | 'peer' | 'confirm' | 'warning' | 'error';
const badgeTones: Record<BadgeTone, string> = {
  brand: styles.badgeBrand,
  neutral: styles.badgeNeutral,
  peer: styles.badgePeer,
  confirm: styles.badgeConfirm,
  warning: styles.badgeWarning,
  error: styles.badgeError,
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <SeedBadge className={cx(styles.badge, badgeTones[tone])}>{children}</SeedBadge>;
}

export function FeedbackAccordion({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Accordion variant="inline" size="medium" className={styles.accordion}>
      <AccordionItem value="details">
        <AccordionHeader>
          <AccordionTrigger className={styles.accordionTrigger}>
            <AccordionTitle className={styles.accordionTitle}>{title}</AccordionTitle>
            <AccordionSuffixIcon className={styles.accordionArrow}>
              <Icon name="expand_more" size={20} />
            </AccordionSuffixIcon>
          </AccordionTrigger>
        </AccordionHeader>
        <AccordionContent>
          <AccordionBody className={styles.accordionBody}>{children}</AccordionBody>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function NavigationTabs({
  value,
  onValueChange,
  items,
  children,
  className,
  listClassName,
  panelClassName,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: { value: string; label: string; icon?: string }[];
  children?: ReactNode;
  className?: string;
  listClassName?: string;
  panelClassName?: string;
}) {
  return (
    <TabsRoot
      value={value}
      onValueChange={onValueChange}
      triggerLayout="hug"
      className={cx(styles.tabs, className)}
    >
      <TabsList aria-label="주요 메뉴" className={cx(styles.tabsList, listClassName)}>
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            aria-selected={value === item.value}
            className={styles.tab}
          >
            {item.icon && <Icon name={item.icon} size={20} />}
            {item.label}
          </TabsTrigger>
        ))}
        <TabsIndicator className={styles.tabsIndicator} />
      </TabsList>
      {items.map((item) => (
        <TabsContent
          key={item.value}
          value={item.value}
          className={cx(styles.tabPanel, panelClassName)}
        >
          {value === item.value ? children : null}
        </TabsContent>
      ))}
    </TabsRoot>
  );
}

export function LoadingSkeleton({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className={styles.skeletonGroup}>
      <SeedSkeleton className={styles.skeleton} />
      <SeedSkeleton className={styles.skeletonShort} />
    </div>
  );
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  return <SeedSnackbarProvider className={styles.snackbarRegion}>{children}</SeedSnackbarProvider>;
}

export function useToast() {
  const adapter = useSnackbarAdapter();
  return (message: string) =>
    adapter.create({ render: () => <Snackbar className={styles.snackbar} message={message} /> });
}
