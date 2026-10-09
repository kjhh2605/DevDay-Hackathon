// SEED composition: https://seed-design.io/react/components/text-field-input
import { Field as SeedField, TextField as SeedTextField } from '@seed-design/react';
import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from 'react';

export interface TextFieldProps extends SeedField.RootProps {
  label: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  controlClassName?: string;
  labelClassName?: string;
  footerClassName?: string;
  inputId?: string;
}

export function TextField({
  label,
  description,
  errorMessage,
  children,
  controlClassName,
  labelClassName,
  footerClassName,
  inputId,
  ...props
}: TextFieldProps) {
  return (
    <SeedField.Root {...props}>
      <SeedField.Header>
        <SeedField.Label className={labelClassName} asChild>
          <label htmlFor={inputId}>
            {label}
            {props.required && <SeedField.RequiredIndicator aria-label="필수" />}
          </label>
        </SeedField.Label>
      </SeedField.Header>
      <SeedTextField.Root className={controlClassName}>{children}</SeedTextField.Root>
      {(description || errorMessage) && (
        <SeedField.Footer className={footerClassName}>
          {errorMessage ? (
            <SeedField.ErrorMessage>{errorMessage}</SeedField.ErrorMessage>
          ) : (
            <SeedField.Description>{description}</SeedField.Description>
          )}
        </SeedField.Footer>
      )}
    </SeedField.Root>
  );
}

export const TextFieldInput = SeedTextField.Input;
// SEED's textarea primitive types omit native rows/cols; asChild preserves the
// native textarea contract while retaining SEED field behavior and styling.
export const TextFieldTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { autoresize?: boolean }
>(({ autoresize, ...props }, ref) => (
  <SeedTextField.Textarea asChild autoresize={autoresize} ref={ref}>
    <textarea {...props} />
  </SeedTextField.Textarea>
));
TextFieldTextarea.displayName = 'TextFieldTextarea';
